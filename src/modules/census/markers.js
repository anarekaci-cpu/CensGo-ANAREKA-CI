import maplibregl from "maplibre-gl";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getClusterGroup, getMap } from "../map/map.js";
import { updatePointVisit } from "../../db/database.js";
import { openCensusForm } from "./censusFormModal.js";
import { toGeoJSONCoordinates } from "../../core/geo.js";
import { escapeHtml, normalizePointId } from "../../core/utils.js";
import { toastWarning, toastError } from "../../core/toast.js";
import { log, isVerbose } from "../../core/debug.js";
import { buildPopupModel } from "./popupModel.js";

const iconCache = new Map();

// --- Marker pool ---
// activeMarkers: pointId -> { marker, el } — currently on the map
// markerPool: reusable { marker, el } objects — off the map, ready to recycle
const activeMarkers = new Map();
const markerPool = [];
const clusterMarkers = [];
let currentPopup = null;
let currentPopupPointId = null;
let moveHandler = null;
let moveRaf = null;
let loadedFeatures = [];

// Index id -> point reconstruit à chaque changement de "points" dans le
// store (abonnement module ci-dessous). Les recherches au clic passent d'un
// O(N) sur tout le store à un O(1), y compris pendant les pans de carte où
// renderVisibleMarkers s'exécute en boucle.
let pointIndex = new Map();

function rebuildPointIndex() {
  const all = store.get("points") || [];
  const idx = new Map();
  for (const p of all) idx.set(normalizePointId(p.id), p);
  pointIndex = idx;
}

store.subscribe("points", () => rebuildPointIndex());
rebuildPointIndex();

/**
 * Retrouve un point par son id — O(1), id normalisé via normalizePointId().
 * Ne retourne JAMAIS silencieusement null sans trace : un marqueur dont le
 * point a disparu du store signale un désalignement (données rechargées,
 * filtre, course de sync) qu'il faut pouvoir diagnostiquer.
 */
function getPointById(pointId) {
  const key = normalizePointId(pointId);
  let point = pointIndex.get(key);
  if (!point) {
    // Fallback sur le store (cas: set() entre le rAF batch et la notification)
    const found = (store.get("points") || []).find(p => normalizePointId(p.id) === key);
    if (found) return found;
    log.warn("MARKER", `Point introuvable pour l'id "${key}" — marqueur/store désalignés.`);
    return null;
  }
  return point;
}

// --- Single delegated click handler for all pooled markers ---
function handleMarkerClick(e) {
  log.trace("MARKER_CLICK", "START");
  const el = e.currentTarget;
  const rawId = el._pointId;
  const pointId = normalizePointId(rawId);
  log.trace("MARKER_CLICK", "pointId =", rawId, "| typeof =", typeof rawId);
  if (!pointId) {
    // Cas B : clic détecté mais pointId invalide (marqueur recyclé entre le
    // mousedown et le click) — sortie silencieuse rendue explicite.
    log.trace("MARKER_CLICK", "STOP: pointId vide (marqueur en cours de recyclage)");
    return;
  }
  e.stopPropagation();

  // Diagnostic terrain (Problème #3) : tracer exactement ce qui arrive au clic.
  log.info("MARKER_CLICK", `pointId="${pointId}" type=${typeof rawId}`);
  log.trace("MARKER_CLICK", "store.points.length =", (store.get("points") || []).length);

  const point = getPointById(pointId);
  log.debug("POINT_LOOKUP",
    `store points=${(store.get("points") || []).length}`,
    `found=${Boolean(point)}`,
    point ? `point.id="${normalizePointId(point.id)}"` : "");
  log.trace("MARKER_CLICK", "pointFound =", Boolean(point));
  if (!point) {
    // Cas C : id valide mais point absent du store (désalignement).
    log.trace("MARKER_CLICK", "STOP: point introuvable dans store pour id", pointId);
    toastWarning("Fiche introuvable dans les données locales. Rechargement…");
    return;
  }
  log.trace("MARKER_CLICK", "point =", point.name, `(${point.lat}, ${point.lon})`);

  closeCurrentPopup();
  log.trace("POPUP", "build START");
  const popup = createPopupForPoint(point);
  log.trace("POPUP", "build RESULT =", popup ? "OK" : "NULL");
  currentPopup = popup;
  currentPopupPointId = pointId;
  log.trace("POPUP", "addTo START");
  popup.addTo(getMap());
  log.trace("POPUP", "addTo END");
  // Audit (efficiency) : verifyPopupVisible() force un reflow synchrone
  // (getComputedStyle + getBoundingClientRect) — coûteux sur chaque tap si
  // on l'exécute inconditionnellement. Réservé au diagnostic terrain
  // (localStorage.DEBUG=1), comme le reste du traçage verbeux.
  if (isVerbose()) verifyPopupVisible(point);
  log.debug("POPUP", `created=true added=true id="${pointId}" name="${point.name}"`);
  log.trace("MARKER_CLICK", "END");

  popup.on("close", () => {
    if (currentPopup === popup) {
      currentPopup = null;
      currentPopupPointId = null;
    }
  });

  // Store popup reference so refreshMarker can update it
  const entry = activeMarkers.get(pointId);
  if (entry) entry.popup = popup;
}

/**
 * Auto-vérification du rendu réel (Cas E/G — popup créé mais invisible) :
 * inspecte le DOM MapLibre et les styles calculés juste après l'ouverture.
 */
function verifyPopupVisible(point) {
  try {
    const popupEl = document.querySelector(".maplibregl-popup");
    if (!popupEl) {
      log.traceAlways("POPUP", "⚠️ DOM: aucun élément .maplibregl-popup trouvé après addTo");
      return;
    }
    const cs = getComputedStyle(popupEl);
    const content = popupEl.querySelector(".maplibregl-popup-content");
    const rect = content ? content.getBoundingClientRect() : null;
    const onScreen = rect && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
    log.traceAlways("POPUP",
      `DOM=présent display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`,
      `zIndex=${cs.zIndex} taille=${rect ? Math.round(rect.width) + "x" + Math.round(rect.height) : "?"}`,
      `à-l'écran=${onScreen}`,
      `titre="${point.name}"`);
  } catch (err) {
    log.warn("POPUP", "vérification DOM impossible:", err.message);
  }
}

let pendingIds = new Set();
store.subscribe("sync.pendingPointIds", (ids) => {
  pendingIds = new Set((ids || []).map(normalizePointId));
  activeMarkers.forEach((_entry, pointId) => refreshMarker(pointId));
});

function isPointPending(pointId) {
  return pendingIds.has(normalizePointId(pointId));
}

function buildIconHTML(color, isVisited, isPending) {
  const key = `${color}_${isVisited}_${isPending}`;
  if (iconCache.has(key)) return iconCache.get(key);

  const opacity = isVisited ? 0.45 : 1;
  const stroke = isPending ? "#b5791a" : (isVisited ? "#555" : "#222");
  const dash = isPending ? 'stroke-dasharray="3,2"' : '';
  const check = isVisited
    ? '<path d="M9 13l2.5 2.5L17 10" stroke="#2e7d32" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    : '';
  const pendingBadge = isPending
    ? '<circle cx="20" cy="6" r="5.5" fill="#f4e3c4" stroke="#b5791a" stroke-width="1.2"/><text x="20" y="8.8" font-size="7" text-anchor="middle">⏳</text>'
    : '';

  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C6 0 0 6 0 13c0 9 13 21 13 21s13-12 13-21C26 6 20 0 13 0z"
      fill="${color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
    <circle cx="13" cy="13" r="5.5" fill="white" fill-opacity="${isVisited ? 0.85 : 1}"/>
    ${check}
    ${pendingBadge}
  </svg>`;
  iconCache.set(key, html);
  return html;
}

function buildPopup(point) {
  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  // Texte du badge statut en variante assombrie : le jaune vif #f1c40f en
  // police sur fond clair était illisible en plein soleil (contraste ~1.9:1).
  const textColor = CONFIG.STATUS_TEXT_COLORS[point.status] || "#566573";
  const userPos = store.get("geo.position");
  const m = buildPopupModel(point, userPos);

  const telLink = m.tel
    ? `<a href="tel:${escapeHtml(m.tel)}" style="color:#166534; font-weight:700; text-decoration:none; background:#f0fdf4; padding:2px 8px; border-radius:6px; border:1px solid #bbf7d0;">📞 ${escapeHtml(m.tel)}</a>`
    : "—";

  const safeId = escapeHtml(m.id);
  const latStr = m.lat != null ? m.lat.toFixed(6) : "—";
  const lonStr = m.lon != null ? m.lon.toFixed(6) : "—";
  const row = (label, value) =>
    `<div class="popup-row"><b>${label}:</b> ${value || "—"}</div>`;

  const div = document.createElement("div");
  div.innerHTML = `
    <div class="popup-title">${escapeHtml(m.order ?? "—")}. ${escapeHtml(m.name)}${m.visited ? ' <span style="color:#15803d; font-size:12px;">✓ Visité</span>' : ''}</div>
    <div class="popup-row"><b>Bloc:</b> ${String(m.block ?? 0).padStart(2, "0")} — Ordre ${escapeHtml(m.order ?? "—")}</div>
    <div class="popup-row"><b>Téléphone:</b> ${telLink}</div>
    ${row("Quartier", escapeHtml(m.quartier))}
    ${row("Adresse", escapeHtml(m.address))}
    ${row("Établissement", escapeHtml(m.etablissement))}
    ${row("Type d'activité", escapeHtml(m.activityType))}
    ${row("Produits", escapeHtml(m.produits))}
    ${row("Sexe", escapeHtml(m.sexe))}
    ${m.zone ? row("Zone", escapeHtml(m.zone)) : ""}
    <div class="popup-row popup-coords">📍 ${latStr}, ${lonStr}</div>
    ${m.createdAt ? `<div class="popup-row popup-updated">🗓️ Recensé le: ${escapeHtml(m.createdAt)}</div>` : ""}
    ${m.updatedAt ? `<div class="popup-row popup-updated">🔄 Mis à jour: ${escapeHtml(m.updatedAt)}</div>` : ""}
    ${m.agent ? `<div class="popup-row popup-updated">👤 Agent: ${escapeHtml(m.agent)}</div>` : ""}
    <div class="popup-status" style="background:${color}22;color:${textColor};border:1px solid ${color}">${escapeHtml(m.status)}</div>
    ${m.distanceLabel ? `<div class="popup-dist">${escapeHtml(m.distanceLabel)}</div>` : ""}
    <div class="btn-row">
      <button class="go-btn" data-action="route" data-id="${safeId}">🧭 Itinéraire</button>
      <button class="go-btn nav-btn" data-action="navigate" data-id="${safeId}">🗺️ Naviguer</button>
    </div>
    <div class="btn-row">
      <button class="visit-btn ${m.visited ? 'btn-unvisit' : 'btn-visit'}" data-action="visit" data-id="${safeId}">
        ${m.visited ? '🔄 Annuler la visite' : '✅ Marquer comme visité'}
      </button>
      <button class="go-btn edit-btn" data-action="edit" data-id="${safeId}" style="background:#475569;">✏️ Éditer</button>
    </div>
  `;

  div.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", handlePopupAction);
  });
  return div;
}

function handlePopupAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  const id = normalizePointId(btn.dataset.id);
  log.trace("ROUTE", `CLICK action=${action} pointId=${id}`);
  const point = getPointById(id);
  log.trace("ROUTE", "pointFound =", Boolean(point));
  if (!point) {
    // Cas B : le bouton reçoit le clic mais le point n'est plus dans le store.
    log.trace("ROUTE", "STOP: point introuvable pour id", id);
    toastWarning("Fiche introuvable dans les données locales.");
    return;
  }

  if (action === "route") {
    // Itinéraire interne : OSRM + tracé sur la carte (navigation.js)
    log.trace("ROUTE", `latitude=${point.lat} longitude=${point.lon}`);
    // BUG (audit) : store.set() ignore silencieusement une valeur si elle a
    // la MÊME RÉFÉRENCE que l'ancienne (core/store.js). `point` vient de
    // pointIndex et garde la même référence tant que le store "points" n'a
    // pas changé — donc un premier échec (GPS pas encore fixé, OSRM en
    // timeout...) laissait chaque clic "Itinéraire" suivant sur CE MÊME point
    // ne rien faire du tout : ni navigation.destination ni navigation.active
    // ne changeaient de valeur, aucun abonné ne se redéclenchait, aucune
    // erreur console. Cloner l'objet garantit une référence différente à
    // chaque clic, donc un nouvel essai systématique.
    store.set("navigation.destination", { ...point });
    store.set("navigation.active", true);
  } else if (action === "navigate") {
    openExternalNavigation(point);
  } else if (action === "visit") {
    toggleVisit(point);
  } else if (action === "edit") {
    openCensusForm(point);
  }
}

/**
 * Navigation externe (Problème #8) : délègue à l'app Maps du téléphone.
 * URL universelle Google Maps — s'ouvre dans l'app native sur Android/iOS,
 * dans le site web sur desktop. destination=lat,lng correspond EXACTEMENT
 * aux coordonnées du point sélectionné ; travelmode=walking cohérent avec
 * le profil piéton des itinéraires internes.
 */
function openExternalNavigation(point) {
  if (point.lat == null || point.lon == null) {
    toastError("Ce point n'a pas de coordonnées GPS exploitables.");
    return;
  }
  const url = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}&travelmode=walking`;
  log.info("NAV_EXTERNAL", `destination=${point.lat},${point.lon}`);
  window.open(url, "_blank", "noopener");
}

async function toggleVisit(point) {
  const newVisited = !point.visited;
  await updatePointVisit(point.id, newVisited, point.status);

  const pid = normalizePointId(point.id);
  const points = (store.get("points") || []).map(p =>
    normalizePointId(p.id) === pid ? { ...p, visited: newVisited } : p
  );
  store.set("points", points);
  refreshMarker(pid);

  // Le popup OUVERT doit refléter immédiatement le nouvel état (avant ce
  // correctif il fallait fermer/rouvrir la fiche pour voir le badge changer).
  if (currentPopup && currentPopupPointId === pid) {
    const updated = points.find(p => normalizePointId(p.id) === pid);
    if (updated) currentPopup.setDOMContent(buildPopup(updated));
  }
}

function closeCurrentPopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
    currentPopupPointId = null;
  }
}

function createPopupForPoint(point) {
  const popup = new maplibregl.Popup({
    offset: [0, -30],
    closeButton: true,
    // Responsive : 92% de la largeur d'écran sur smartphone (max 340px)
    // au lieu d'un 320px fixe qui débordait sur les petits écrans.
    maxWidth: "min(92vw, 340px)",
    closeOnClick: false
  });
  popup.setDOMContent(buildPopup(point));
  return popup;
}

// --- Pool helpers ---

function acquireMarker() {
  const pooled = markerPool.pop();
  if (pooled) return pooled;
  const el = document.createElement("div");
  el.className = "pin-hit";
  el.style.cursor = "pointer";
  el.addEventListener("click", handleMarkerClick);
  return {
    el,
    marker: new maplibregl.Marker({ element: el, anchor: "bottom" })
  };
}

function releaseMarker(entry) {
  // Close popup if it belongs to this marker
  if (entry.popup && entry.popup === currentPopup) {
    entry.popup.remove();
    currentPopup = null;
    currentPopupPointId = null;
  }
  entry.popup = null;
  entry.marker.remove();
  entry.el._pointId = null;
  markerPool.push({ marker: entry.marker, el: entry.el });
}

// --- Core rendering ---

function renderVisibleMarkers() {
  const map = getMap();
  const cluster = getClusterGroup();
  if (!map || !cluster) return;

  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const bbox = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth()
  ];

  const clusters = cluster.getClusters(bbox, zoom);

  // Clean up old cluster markers (they are recreated each render, never pooled)
  for (const cm of clusterMarkers) cm.remove();
  clusterMarkers.length = 0;

  // Collect which pointIds should be visible — ids NORMALISÉS obligatoire :
  // feature.properties.id peut être un number (vieux cache IndexedDB) alors
  // que activeMarkers et currentPopupPointId sont des strings normalisées.
  // Sans cette normalisation, chaque moveend (recentrage GPS, pan…) croyait
  // le popup courant "plus visible" et le FERMAIT immédiatement après son
  // ouverture, en recyclant tous les marqueurs — sans aucune erreur console.
  const visibleIds = new Set();

  for (const feature of clusters) {
    if (!feature.properties.cluster) {
      visibleIds.add(normalizePointId(feature.properties.id));
    }
  }

  // Only close popup if its point is no longer visible (was recycled)
  if (currentPopup && currentPopupPointId && !visibleIds.has(currentPopupPointId)) {
    log.trace("POPUP", `fermé par renderVisibleMarkers (id "${currentPopupPointId}" hors viewport)`);
    closeCurrentPopup();
  }

  // Return markers that are no longer visible to the pool
  for (const [pointId, entry] of activeMarkers) {
    if (!visibleIds.has(pointId)) {
      releaseMarker(entry);
      activeMarkers.delete(pointId);
    }
  }

  // Create or update markers for visible points
  for (const feature of clusters) {
    const props = feature.properties;

    if (props.cluster) {
      // Cluster markers: track for cleanup on next render
      const el = document.createElement("div");
      el.className = "cluster-marker";
      el.textContent = props.point_count;

      const cm = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);
      clusterMarkers.push(cm);

      el.addEventListener("click", () => {
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom: Math.min(zoom + 2, cluster.options.maxZoom + 1),
          duration: 400
        });
      });

    } else {
      const pointId = normalizePointId(props.id);
      const point = getPointById(pointId);
      if (!point) continue;

      const existing = activeMarkers.get(pointId);
      if (existing) {
        // Already on screen — update innerHTML only if icon changed
        const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
        const newHtml = buildIconHTML(color, point.visited, isPointPending(pointId));
        if (existing.el.innerHTML !== newHtml) {
          existing.el.innerHTML = newHtml;
        }
        const coords = toGeoJSONCoordinates(point.lat, point.lon);
        if (coords) existing.marker.setLngLat(coords);
        continue;
      }

      // Acquire a marker from the pool or create new
      const { marker, el } = acquireMarker();
      const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
      el.innerHTML = buildIconHTML(color, point.visited, isPointPending(pointId));
      el._pointId = pointId;

      const coords = toGeoJSONCoordinates(point.lat, point.lon);
      if (coords) marker.setLngLat(coords);
      marker.addTo(map);

      activeMarkers.set(pointId, { marker, el, popup: null });
    }
  }
}

export function renderMarkers(points) {
  const map = getMap();
  const cluster = getClusterGroup();
  if (!map || !cluster) return;

  // Return all active markers to the pool
  for (const [, entry] of activeMarkers) {
    releaseMarker(entry);
  }
  activeMarkers.clear();
  closeCurrentPopup();

  const t0 = performance.now();
  // Conversion centralisée via toGeoJSONCoordinates() : un point sans
  // coordonnées fiables ne produit JAMAIS de feature [null, null] ni de
  // paire inversée [lat, lon] (atterrissage à (0,0) ou mauvais hémisphère).
  loadedFeatures = (Array.isArray(points) ? points : [])
    .map(p => ({ p, coords: toGeoJSONCoordinates(p.lat, p.lon) }))
    .filter(({ coords }) => coords !== null)
    .map(({ p, coords }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: { ...p }
    }));

  cluster.load(loadedFeatures);

  if (moveHandler) {
    map.off("moveend", moveHandler);
  }
  moveHandler = () => {
    if (moveRaf) cancelAnimationFrame(moveRaf);
    moveRaf = requestAnimationFrame(() => {
      moveRaf = null;
      renderVisibleMarkers();
    });
  };
  map.on("moveend", moveHandler);

  renderVisibleMarkers();
  const ms = Math.round(performance.now() - t0);
  // Instrumentation perf (#23) : visible dans l'onglet Performance / console.
  // Un cluster.load > 100ms sur ce volume signalerait une régression.
  console.info(`🗺️ [PERF] CLUSTERING+MARKERS ${ms}ms · ${loadedFeatures.length} features`);
}

export function upsertMarker(point) {
  const pid = normalizePointId(point.id);
  const existing = activeMarkers.get(pid);
  if (existing) {
    refreshMarker(pid);
    return;
  }

  const cluster = getClusterGroup();
  if (!cluster) return;
  const coords = toGeoJSONCoordinates(point.lat, point.lon);
  if (!coords) return;

  loadedFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: { ...point }
  });

  cluster.load(loadedFeatures);
  renderVisibleMarkers();
}

export function refreshMarker(pointId) {
  const pid = normalizePointId(pointId);
  const entry = activeMarkers.get(pid);
  const point = getPointById(pid);
  if (!entry || !point) return;

  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  const newHtml = buildIconHTML(color, point.visited, isPointPending(pid));
  if (entry.el.innerHTML !== newHtml) {
    entry.el.innerHTML = newHtml;
  }

  if (entry.popup && entry.popup.isOpen()) {
    entry.popup.setDOMContent(buildPopup(point));
  }
}

export function openPopup(pointId) {
  const pid = normalizePointId(pointId);
  const point = getPointById(pid);
  if (!point) return;

  const map = getMap();
  closeCurrentPopup();
  const popup = createPopupForPoint(point);
  currentPopup = popup;
  currentPopupPointId = pid;
  popup.addTo(map);

  popup.on("close", () => {
    if (currentPopup === popup) {
      currentPopup = null;
      currentPopupPointId = null;
    }
  });

  const entry = activeMarkers.get(pid);
  if (entry) entry.popup = popup;
}

export function getFilteredBounds() {
  if (activeMarkers.size === 0) return null;
  const map = getMap();
  if (!map) return null;

  const bounds = new maplibregl.LngLatBounds();
  activeMarkers.forEach((entry) => {
    bounds.extend(entry.marker.getLngLat());
  });

  return [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]];
}
