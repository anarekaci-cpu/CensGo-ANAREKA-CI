import maplibregl from "maplibre-gl";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getClusterGroup, getMap } from "../map/map.js";
import { updatePointVisit } from "../../db/database.js";
import { openCensusForm } from "./censusFormModal.js";
import { haversineKm } from "../../core/geo.js";
import { escapeHtml } from "../../core/utils.js";
import { toastWarning } from "../../core/toast.js";

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
  for (const p of all) idx.set(String(p.id), p);
  pointIndex = idx;
}

store.subscribe("points", () => rebuildPointIndex());
rebuildPointIndex();

/**
 * Retrouve un point par son id — O(1). Ne retourne JAMAIS silencieusement
 * null sans trace : un marqueur dont le point a disparu du store signale un
 * désalignement (données rechargées, filtre, course de sync) qu'il faut
 * pouvoir diagnostiquer.
 */
function getPointById(pointId) {
  const key = String(pointId);
  let point = pointIndex.get(key);
  if (!point) {
    // Fallback sur le store (cas: set() entre le rAF batch et la notification)
    const found = (store.get("points") || []).find(p => String(p.id) === key);
    if (found) return found;
    console.warn(`[MARKERS] Point introuvable pour l'id "${key}" — marqueur/store désalignés.`);
    return null;
  }
  return point;
}

// --- Single delegated click handler for all pooled markers ---
function handleMarkerClick(e) {
  const el = e.currentTarget;
  const pointId = el._pointId;
  if (!pointId) return;
  e.stopPropagation();

  const point = getPointById(pointId);
  if (!point) {
    // Garde-fou anti-affichage croisé : jamais les infos d'un autre point,
    // et jamais un échec muet — l'agent sait que quelque chose cloche.
    toastWarning("Fiche introuvable dans les données locales. Rechargement…");
    return;
  }

  closeCurrentPopup();
  const popup = createPopupForPoint(point);
  currentPopup = popup;
  currentPopupPointId = pointId;
  popup.addTo(getMap());

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

let pendingIds = new Set();
store.subscribe("sync.pendingPointIds", (ids) => {
  pendingIds = new Set(ids || []);
  activeMarkers.forEach((_entry, pointId) => refreshMarker(pointId));
});

function isPointPending(pointId) {
  return pendingIds.has(pointId);
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
  let distHtml = "";

  if (userPos && point.lat != null && point.lon != null) {
    const d = haversineKm(userPos.lat, userPos.lng, point.lat, point.lon);
    distHtml = `<div class="popup-dist">📍 ${formatDist(d)} de vous</div>`;
  }

  const telLink = point.tel
    ? `<a href="tel:${escapeHtml(point.tel)}" style="color:#166534; font-weight:700; text-decoration:none; background:#f0fdf4; padding:2px 8px; border-radius:6px; border:1px solid #bbf7d0;">📞 ${escapeHtml(point.tel)}</a>`
    : "—";

  const safeId = escapeHtml(point.id);
  const latStr = point.lat != null ? point.lat.toFixed(6) : "—";
  const lonStr = point.lon != null ? point.lon.toFixed(6) : "—";
  const updatedStr = point.updatedAt
    ? new Date(point.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const div = document.createElement("div");
  div.innerHTML = `
    <div class="popup-title">${escapeHtml(point.order)}. ${escapeHtml(point.name || "(sans nom)")}${point.visited ? ' <span style="color:#15803d; font-size:12px;">✓ Visité</span>' : ''}</div>
    <div class="popup-row"><b>Bloc:</b> ${String(point.block).padStart(2, "0")} — Ordre ${escapeHtml(point.order)}</div>
    <div class="popup-row"><b>Téléphone:</b> ${telLink}</div>
    <div class="popup-row"><b>Quartier:</b> ${escapeHtml(point.quartier || "—")}</div>
    <div class="popup-row"><b>Adresse:</b> ${escapeHtml(point.address || "—")}</div>
    <div class="popup-row"><b>Établissement:</b> ${escapeHtml(point.etablissement || "—")}</div>
    <div class="popup-row"><b>Type d'activité:</b> ${escapeHtml(point.activityType || "—")}</div>
    <div class="popup-row"><b>Produits:</b> ${escapeHtml(point.produits || "—")}</div>
    <div class="popup-row"><b>Sexe:</b> ${escapeHtml(point.sexe || "—")}</div>
    <div class="popup-row popup-coords">📍 ${latStr}, ${lonStr}</div>
    <div class="popup-row popup-updated">🗓️ Mis à jour: ${updatedStr}</div>
    <div class="popup-status" style="background:${color}22;color:${textColor};border:1px solid ${color}">${escapeHtml(point.status)}</div>
    ${distHtml}
    <div class="btn-row">
      <button class="go-btn" data-action="route" data-id="${safeId}">🧭 Itinéraire</button>
      <button class="go-btn nav-btn" data-action="navigate" data-id="${safeId}">🗺️ Naviguer</button>
    </div>
    <div class="btn-row">
      <button class="visit-btn ${point.visited ? 'btn-unvisit' : 'btn-visit'}" data-action="visit" data-id="${safeId}">
        ${point.visited ? '🔄 Annuler la visite' : '✅ Marquer comme visité'}
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
  const id = btn.dataset.id;
  const point = getPointById(id);
  if (!point) return;

  if (action === "route" || action === "navigate") {
    store.set("navigation.destination", point);
    store.set("navigation.active", true);
  } else if (action === "visit") {
    toggleVisit(point);
  } else if (action === "edit") {
    openCensusForm(point);
  }
}

async function toggleVisit(point) {
  const newVisited = !point.visited;
  await updatePointVisit(point.id, newVisited, point.status);

  const points = store.get("points").map(p =>
    p.id === point.id ? { ...p, visited: newVisited } : p
  );
  store.set("points", points);
  refreshMarker(point.id);
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

  // Collect which pointIds should be visible
  const visibleIds = new Set();

  for (const feature of clusters) {
    if (!feature.properties.cluster) {
      visibleIds.add(feature.properties.id);
    }
  }

  // Only close popup if its point is no longer visible (was recycled)
  if (currentPopup && currentPopupPointId && !visibleIds.has(currentPopupPointId)) {
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
      const pointId = props.id;
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
        existing.marker.setLngLat([point.lon, point.lat]);
        continue;
      }

      // Acquire a marker from the pool or create new
      const { marker, el } = acquireMarker();
      const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
      el.innerHTML = buildIconHTML(color, point.visited, isPointPending(pointId));
      el._pointId = pointId;

      marker.setLngLat([point.lon, point.lat]);
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
  // Garde-fou : un point sans coordonnées fiables ne produit JAMAIS de
  // feature GeoJSON [null, null] (casserait le clustering / atterrirait à (0,0)).
  loadedFeatures = (Array.isArray(points) ? points : [])
    .filter(p => p.lat != null && p.lon != null)
    .map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
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
  const existing = activeMarkers.get(point.id);
  if (existing) {
    refreshMarker(point.id);
    return;
  }

  const cluster = getClusterGroup();
  if (!cluster) return;
  // Un point sans coordonnées fiables ne doit jamais produire de feature
  // GeoJSON [null, null] (casserait le clustering / atterrirait à (0,0)).
  if (point.lat == null || point.lon == null) return;

  loadedFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: { ...point }
  });

  cluster.load(loadedFeatures);
  renderVisibleMarkers();
}

export function refreshMarker(pointId) {
  const entry = activeMarkers.get(pointId);
  const point = getPointById(pointId);
  if (!entry || !point) return;

  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  const newHtml = buildIconHTML(color, point.visited, isPointPending(pointId));
  if (entry.el.innerHTML !== newHtml) {
    entry.el.innerHTML = newHtml;
  }

  if (entry.popup && entry.popup.isOpen()) {
    entry.popup.setDOMContent(buildPopup(point));
  }
}

export function openPopup(pointId) {
  const point = getPointById(pointId);
  if (!point) return;

  const map = getMap();
  closeCurrentPopup();
  const popup = createPopupForPoint(point);
  currentPopup = popup;
  currentPopupPointId = pointId;
  popup.addTo(map);

  popup.on("close", () => {
    if (currentPopup === popup) {
      currentPopup = null;
      currentPopupPointId = null;
    }
  });

  const entry = activeMarkers.get(pointId);
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

function formatDist(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}
