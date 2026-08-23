import { store } from "./store.js";
import { CONFIG } from "./config.js";
import { haversineKm } from "./geo.js";
import { toastWarning } from "./toast.js";

/**
 * Anti-fraude terrain : un agent ne doit pouvoir marquer un point "visité"
 * que s'il se trouve réellement à proximité (VISIT_GEOFENCE_RADIUS_M) —
 * sans ce contrôle, n'importe quelle fiche pouvait être cochée "visité"
 * depuis n'importe où, y compris sans jamais s'être déplacé sur le terrain.
 * Appelé depuis le popup carte (markers.js) et la fiche de recensement
 * (censusFormModal.js), les deux points où "visited" peut passer à true.
 *
 * Volontairement fail-closed : GPS indisponible = refus plutôt que de
 * laisser un agent désactiver sa localisation pour contourner le contrôle.
 * Les admins sont exemptés (correction de fiches à distance).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function canMarkVisited(lat, lon) {
  if (store.get("ui.isAdmin")) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;

  const position = store.get("geo.position");
  if (!position) {
    toastWarning("Position GPS indisponible : activez la localisation pour marquer ce point visité.");
    return false;
  }

  const distanceM = haversineKm(position.lat, position.lng, lat, lon) * 1000;
  if (distanceM > CONFIG.VISIT_GEOFENCE_RADIUS_M) {
    toastWarning(
      `Vous êtes à ${Math.round(distanceM)} m de ce point (max ${CONFIG.VISIT_GEOFENCE_RADIUS_M} m). ` +
      `Rapprochez-vous du lieu pour le marquer visité.`
    );
    return false;
  }

  return true;
}
