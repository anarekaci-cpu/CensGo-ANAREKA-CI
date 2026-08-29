import maplibregl from "maplibre-gl";
import { store } from "../../core/store.js";
import { addHazard, resolveHazard } from "../../db/database.js";
import { toastSuccess, toastWarning } from "../../core/toast.js";
import { escapeHtml } from "../../core/utils.js";
import { log } from "../../core/debug.js";
import { getMap } from "../map/map.js";
import { chooseHazardType } from "./hazardReportModal.js";

const HAZARD_ICONS = { flooding: "🌊", road_blocked: "🚧", other: "⚠️" };
const HAZARD_LABELS = { flooding: "Inondation", road_blocked: "Route bloquée", other: "Danger signalé" };

// pointId -> instance maplibregl.Marker actuellement sur la carte. Volume
// attendu faible (quelques dizaines au plus) : pas besoin du pool de
// marqueurs DOM construit pour les centaines de points de recensement
// (voir modules/census/markers.js) — une instance Marker par danger suffit.
const activeHazardMarkers = new Map();

function buildHazardPopupHtml(hazard) {
  const label = HAZARD_LABELS[hazard.hazardType] || HAZARD_LABELS.other;
  const date = new Date(hazard.createdAt).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
  return `
    <div class="hazard-popup">
      <div class="popup-title">${HAZARD_ICONS[hazard.hazardType] || "⚠️"} ${escapeHtml(label)}</div>
      ${hazard.note ? `<div class="popup-row">${escapeHtml(hazard.note)}</div>` : ""}
      <div class="popup-updated">Signalé le ${escapeHtml(date)}${hazard.pendingSync ? " · en attente d'envoi" : ""}</div>
      <button type="button" class="hazard-resolve-btn" data-id="${escapeHtml(hazard.id)}">✅ Marquer résolu</button>
    </div>
  `;
}

async function handleResolveClick(hazardId) {
  try {
    await resolveHazard(hazardId);
    toastSuccess("Danger marqué résolu.");
    store.set("hazards", (store.get("hazards") || []).filter(h => h.id !== hazardId));
  } catch (err) {
    log.warn("HAZARD", "Échec du marquage résolu :", err?.message || err);
    toastWarning("Impossible de marquer ce danger résolu pour le moment.");
  }
}

function createHazardMarker(hazard, map) {
  const el = document.createElement("div");
  el.className = "hazard-marker";
  el.textContent = HAZARD_ICONS[hazard.hazardType] || "⚠️";
  el.style.cssText = "font-size:28px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));cursor:pointer;";

  const popup = new maplibregl.Popup({ offset: 20 }).setHTML(buildHazardPopupHtml(hazard));
  popup.on("open", () => {
    popup.getElement()?.querySelector(".hazard-resolve-btn")
      ?.addEventListener("click", (e) => handleResolveClick(e.currentTarget.dataset.id));
  });

  return new maplibregl.Marker({ element: el })
    .setLngLat([hazard.lon, hazard.lat])
    .setPopup(popup)
    .addTo(map);
}

function renderHazardMarkers(hazards) {
  const map = getMap();
  if (!map) return;

  const list = Array.isArray(hazards) ? hazards : [];
  const activeIds = new Set(list.map(h => h.id));

  for (const [id, marker] of activeHazardMarkers) {
    if (!activeIds.has(id)) {
      marker.remove();
      activeHazardMarkers.delete(id);
    }
  }

  list.forEach((hazard) => {
    if (activeHazardMarkers.has(hazard.id)) return;
    activeHazardMarkers.set(hazard.id, createHazardMarker(hazard, map));
  });
}

function ensureReportButton() {
  if (document.getElementById("hazardReportBtn")) return;

  const btn = document.createElement("button");
  btn.id = "hazardReportBtn";
  btn.type = "button";
  btn.title = "Signaler un danger";
  btn.setAttribute("aria-label", "Signaler un danger");
  btn.textContent = "⚠️";
  // Positionnement en miroir de #fabAdd (bas-droite, voir appView.js/style.css) :
  // même bande verticale, côté opposé — action secondaire, ne doit jamais
  // se superposer à l'action principale "Nouveau point".
  btn.style.cssText = "position:fixed;left:18px;bottom:84px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:1px solid rgba(255,255,255,0.25);font-size:24px;line-height:1;cursor:pointer;z-index:200;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(217,119,6,0.4);";
  btn.addEventListener("click", () => reportHazard());
  document.body.appendChild(btn);
}

/**
 * Initialise l'affichage des dangers partagés — à appeler une fois après le
 * montage de la carte (voir appView.js, même moment que initNavigation()).
 */
export function initHazards() {
  ensureReportButton();
  store.subscribe("hazards", renderHazardMarkers);
  renderHazardMarkers(store.get("hazards"));
}

/**
 * Signale un danger à la position GPS actuelle de l'agent.
 */
export async function reportHazard() {
  const position = store.get("geo.position");
  if (!position) {
    toastWarning("Position GPS indisponible — activez la localisation pour signaler un danger.");
    return;
  }

  const hazardType = await chooseHazardType();
  if (!hazardType) return;

  try {
    const hazard = await addHazard({ hazardType, lat: position.lat, lon: position.lng });
    store.set("hazards", [...(store.get("hazards") || []), hazard]);
    toastSuccess("Danger signalé — visible par les autres agents dès la prochaine synchronisation.");
  } catch (err) {
    log.warn("HAZARD", "Échec du signalement :", err?.message || err);
    toastWarning("Impossible d'enregistrer ce signalement pour le moment.");
  }
}
