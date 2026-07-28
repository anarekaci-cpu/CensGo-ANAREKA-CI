import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { addRouteLayer, clearRouteLayers } from "../map/map.js";

export async function calculateRoute(fromLat, fromLng, toLat, toLng) {
  const url = `${CONFIG.OSRM_URL}/route/v1/foot/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error("Itinéraire impossible");
    }

    const route = data.routes[0];
    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      steps: route.legs[0]?.steps || []
    };
  } catch (err) {
    console.error("Routing error:", err);
    throw err;
  }
}

export function displayRoute(geometry) {
  clearRouteLayers();
  addRouteLayer(geometry);
}

export function clearRoute() {
  clearRouteLayers();
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
