import L from "leaflet";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getClusterGroup } from "../map/map.js";
import { updatePointVisit } from "../../db/database.js";
import { openCensusForm } from "./censusFormModal.js";
import { haversineKm } from "../../core/geo.js";

const iconCache = new Map();
const markerRegistry = new Map();

// IDs des points en attente d'envoi vers Supabase (maj par syncEngine via le store) —
// permet d'afficher un badge "pas encore synchronisé" sur une fiche fraîchement créée,
// pour qu'un agent ne croie pas à tort qu'elle est déjà enregistrée côté serveur.
let pendingIds = new Set();
store.subscribe("sync.pendingPointIds", (ids) => {
  pendingIds = new Set(ids || []);
  markerRegistry.forEach((_marker, pointId) => refreshMarker(pointId));
});

function isPointPending(pointId) {
  return pendingIds.has(pointId);
}

function getIcon(color, isVisited, isPending) {
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C6 0 0 6 0 13c0 9 13 21 13 21s13-12 13-21C26 6 20 0 13 0z"
      fill="${color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
    <circle cx="13" cy="13" r="5.5" fill="white" fill-opacity="${isVisited ? 0.85 : 1}"/>
    ${check}
    ${pendingBadge}
  </svg>`;

  const icon = L.divIcon({
    html: svg, className: "",
    iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -30]
  });
  iconCache.set(key, icon);
  return icon;
}

function buildPopup(point) {
  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  const userPos = store.get("geo.position");
  let distHtml = "";

  if (userPos) {
    const d = haversineKm(userPos.lat, userPos.lng, point.lat, point.lon);
    distHtml = `<div class="popup-dist">📍 ${formatDist(d)} de vous</div>`;
  }

  const telLink = point.tel
    ? `<a href="tel:${escapeHtml(point.tel)}" style="color:#166534; font-weight:700; text-decoration:none; background:#f0fdf4; padding:2px 8px; border-radius:6px; border:1px solid #bbf7d0;">📞 ${escapeHtml(point.tel)}</a>`
    : "—";

  const div = document.createElement("div");
  div.innerHTML = `
    <div class="popup-title">${escapeHtml(point.order)}. ${escapeHtml(point.name || "(sans nom)")}${point.visited ? ' <span style="color:#15803d; font-size:12px;">✓ Visité</span>' : ''}</div>
    <div class="popup-row"><b>Bloc:</b> ${String(point.block).padStart(2, "0")} — Ordre ${escapeHtml(point.order)}</div>
    <div class="popup-row"><b>Téléphone:</b> ${telLink}</div>
    <div class="popup-row"><b>Quartier:</b> ${escapeHtml(point.quartier || "—")}</div>
    <div class="popup-row"><b>Adresse:</b> ${escapeHtml(point.address || "—")}</div>
    <div class="popup-row"><b>Produits:</b> ${escapeHtml(point.produits || "—")}</div>
    <div class="popup-row"><b>Sexe:</b> ${escapeHtml(point.sexe || "—")}</div>
    <div class="popup-status" style="background:${color}22;color:${color};border:1px solid ${color}">${escapeHtml(point.status)}</div>
    ${distHtml}
    <div class="btn-row">
      <button class="go-btn" data-action="route" data-id="${point.id}">🧭 Itinéraire</button>
      <button class="go-btn nav-btn" data-action="navigate" data-id="${point.id}">🗺️ Naviguer</button>
    </div>
    <div class="btn-row">
      <button class="visit-btn ${point.visited ? 'btn-unvisit' : 'btn-visit'}" data-action="visit" data-id="${point.id}">
        ${point.visited ? '🔄 Annuler la visite' : '✅ Marquer comme visité'}
      </button>
      <button class="go-btn edit-btn" data-action="edit" data-id="${point.id}" style="background:#475569;">✏️ Éditer</button>
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

export function renderMarkers(points) {
  const group = getClusterGroup();
  if (!group) return;

  group.clearLayers();
  markerRegistry.clear();

  points.forEach(point => {
    const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
    const marker = L.marker([point.lat, point.lon], {
      icon: getIcon(color, point.visited, isPointPending(point.id))
    });

    marker.pointId = point.id;
    marker.bindPopup(() => buildPopup(point));

    markerRegistry.set(point.id, marker);
    group.addLayer(marker);
  });
}

export function upsertMarker(point) {
  const group = getClusterGroup();
  if (!group) return;

  const existing = markerRegistry.get(point.id);
  if (existing) {
    refreshMarker(point.id);
    return;
  }

  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  const marker = L.marker([point.lat, point.lon], {
    icon: getIcon(color, point.visited, isPointPending(point.id))
  });

  marker.pointId = point.id;
  marker.bindPopup(() => buildPopup(point));

  markerRegistry.set(point.id, marker);
  group.addLayer(marker);
}

export function refreshMarker(pointId) {
  const marker = markerRegistry.get(pointId);
  const point = store.get("points").find(p => p.id === pointId);
  if (!marker || !point) return;

  const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
  marker.setIcon(getIcon(color, point.visited, isPointPending(point.id)));

  if (marker.getPopup()?.isOpen()) {
    marker.setPopupContent(buildPopup(point));
  }
}

export function openPopup(pointId) {
  const marker = markerRegistry.get(pointId);
  if (marker) marker.openPopup();
}

export function getFilteredBounds() {
  const group = getClusterGroup();
  if (!group || group.getLayers().length === 0) return null;
  return group.getBounds();
}

function formatDist(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}

function escapeHtml(str) {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}
