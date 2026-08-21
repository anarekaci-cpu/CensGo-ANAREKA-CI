import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { addRouteLayer, clearRouteLayers, fitRouteBounds, showDestinationMarker, hideDestinationMarker } from "../map/map.js";
import { isValidLatLng } from "../../core/normalize.js";
import { log } from "../../core/debug.js";

/**
 * Calcule un itinéraire piéton via OSRM.
 *
 * Ordre des arguments : (lat, lng) côté appelant — conversion interne en
 * (lng, lat) exigée par l'API OSRM. Toute paire invalide est rejetée AVANT
 * l'appel réseau plutôt que de produire une route absurde de l'autre côté
 * du globe.
 */
export async function calculateRoute(fromLat, fromLng, toLat, toLng) {
  if (!isValidLatLng(fromLat, fromLng) || !isValidLatLng(toLat, toLng)) {
    log.error("ROUTE", `coordonnées invalides origin=(${fromLat},${fromLng}) destination=(${toLat},${toLng})`);
    throw new Error("Coordonnées invalides pour le calcul d'itinéraire");
  }

  const url = `${CONFIG.OSRM_URL}/route/v1/foot/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`;
  log.info("ROUTE", `request started origin=[${fromLat},${fromLng}] destination=[${toLat},${toLng}]`);

  try {
    const res = await fetch(url);
    log.debug("ROUTE", `response ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error("Itinéraire impossible");
    }

    const route = data.routes[0];
    log.info("ROUTE",
      `geometry received ${(route.geometry?.coordinates?.length || 0)} points`,
      `${Math.round(route.distance)}m / ${Math.round(route.duration)}s`);
    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      steps: route.legs[0]?.steps || []
    };
  } catch (err) {
    log.error("ROUTE", "échec:", err.message);
    throw err;
  }
}

export function displayRoute(geometry) {
  clearRouteLayers();
  addRouteLayer(geometry);
  // La route était calculée puis dessinée HORS ÉCRAN quand origine et
  // destination n'étaient pas dans le viewport actuel — l'agent croyait à
  // un échec. On cadre la caméra sur la totalité du tracé.
  fitRouteBounds(geometry);
}

export function showRouteDestination(lat, lon) {
  showDestinationMarker(lat, lon);
}

export function hideRouteDestination() {
  hideDestinationMarker();
}

export function clearRoute() {
  clearRouteLayers();
  hideDestinationMarker();
  store.set("navigation.route", null);
  store.set("navigation.instruction", "");
}

export function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}min`;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
