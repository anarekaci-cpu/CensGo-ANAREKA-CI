import maplibregl from "maplibre-gl";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getClusterGroup, getMap } from "../map/map.js";
import { updatePointVisit } from "../../db/database.js";
import { openCensusForm } from "./censusFormModal.js";
import { haversineKm } from "../../core/geo.js";
import { escapeHtml } from "../../core/utils.js";

const iconCache = new Map();
const markerRegistry = new Map();
let currentPopup = null;
let moveHandler = null;
let moveRaf = null;
let loadedFeatures = [];

let pendingIds = new Set();
store.subscribe("sync.pendingPointIds", (ids) => {
  pendingIds = new Set(ids || []);
  markerRegistry.forEach((_entry, pointId) => refreshMarker(pointId));
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
    <div class="popup-status" style="background:${color}22;color:${color};border:1px solid ${color}">${escapeHtml(point.status)}</div>
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
  const point = store.get("points").find(p => p.id === id);
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
  }
}

function createPopupForPoint(point) {
  const popup = new maplibregl.Popup({
    offset: [0, -30],
    closeButton: true,
    maxWidth: "320px",
    closeOnClick: false
  });
  popup.setDOMContent(buildPopup(point));
  return popup;
}

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

  closeCurrentPopup();

  markerRegistry.forEach((entry) => {
    entry.marker.remove();
  });
  markerRegistry.clear();

  const allPoints = store.get("points") || [];
  const pointsById = new Map(allPoints.map(p => [p.id, p]));

  clusters.forEach((feature) => {
    const props = feature.properties;

    if (props.cluster) {
      const el = document.createElement("div");
      el.className = "cluster-marker";
      el.textContent = props.point_count;

      new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);

      el.addEventListener("click", () => {
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom: Math.min(zoom + 2, cluster.options.maxZoom + 1),
          duration: 400
        });
      });

    } else {
      const pointId = props.id;
      const point = pointsById.get(pointId);
      if (!point) return;

      const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
      const el = document.createElement("div");
      el.innerHTML = buildIconHTML(color, point.visited, isPointPending(pointId));
      el.style.cursor = "pointer";

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([point.lon, point.lat])
        .addTo(map);

      const popup = createPopupForPoint(point);

      // Ne pas utiliser marker.setPopup(popup) : MapLibre y attache son propre
      // gestionnaire de clic qui bascule le popup (ouvre/ferme), en plus de
      // celui ci-dessous qui gère l'ouverture manuellement — les deux se
      // marchaient dessus et le popup finissait par ne plus s'ouvrir du tout.

      marker.getElement().addEventListener("click", (e) => {
        e.stopPropagation();
        closeCurrentPopup();
        currentPopup = popup;
        popup.addTo(map);
      });

      marker.pointId = pointId;
      markerRegistry.set(pointId, { marker, popup, point });
    }
  });
}

export function renderMarkers(points) {
  const map = getMap();
  const cluster = getClusterGroup();
  if (!map || !cluster) return;

  markerRegistry.forEach((entry) => entry.marker.remove());
  markerRegistry.clear();
  closeCurrentPopup();

  loadedFeatures = points.map(p => ({
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
}

export function upsertMarker(point) {
  const existing = markerRegistry.get(point.id);
  if (existing) {
    refreshMarker(point.id);
    return;
  }

  const cluster = getClusterGroup();
  if (!cluster) return;

  loadedFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: { ...point }
  });

  cluster.load(loadedFeatures);
  renderVisibleMarkers();
}

export function refreshMarker(pointId) {
  const entry = markerRegistry.get(pointId);
  const point = store.get("points").find(p => p.id === pointId);
  if (!entry || !point) return;

  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  entry.marker.getElement().innerHTML = buildIconHTML(color, point.visited, isPointPending(pointId));

  if (entry.popup.isOpen()) {
    entry.popup.setDOMContent(buildPopup(point));
  }

  entry.point = point;
}

export function openPopup(pointId) {
  const entry = markerRegistry.get(pointId);
  if (!entry) return;

  const map = getMap();
  closeCurrentPopup();
  currentPopup = entry.popup;
  entry.popup.addTo(map);
}

export function getFilteredBounds() {
  if (markerRegistry.size === 0) return null;
  const map = getMap();
  if (!map) return null;

  const bounds = new maplibregl.LngLatBounds();
  markerRegistry.forEach((entry) => {
    bounds.extend(entry.marker.getLngLat());
  });

  return [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]];
}

function formatDist(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}
