import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { addRouteLayer, clearRouteLayers } from "../map/map.js";

let navUnsubs = [];

/**
 * Met en place les abonnements qui pilotent la navigation :
 * - calcule l'itinéraire quand une destination est choisie
 * - suit la position GPS pour mettre à jour l'instruction et détecter l'arrivée
 */
export function initNavigation() {
  navUnsubs.forEach(unsub => unsub());
  navUnsubs = [];

  navUnsubs.push(store.subscribe("navigation.active", (active) => {
    if (active) {
      startNavigation();
    } else {
      clearRoute();
    }
  }));

  navUnsubs.push(store.subscribe("geo.position", (position) => {
    if (store.get("navigation.active") && position) {
      updateNavigationProgress(position);
    }
  }));
}

async function startNavigation() {
  const destination = store.get("navigation.destination");
  const position = store.get("geo.position");
  if (!destination || !position) return;

  try {
    const route = await calculateRoute(position.lat, position.lng, destination.lat, destination.lon);
    store.set("navigation.route", route);
    displayRoute(route.geometry);
    store.set("navigation.instruction", `${formatDistance(route.distance)} — ${formatDuration(route.duration)}`);
  } catch (err) {
    store.set("navigation.instruction", "Itinéraire indisponible");
  }
}

function updateNavigationProgress(position) {
  const destination = store.get("navigation.destination");
  if (!destination) return;

  const distance = haversineMeters(position.lat, position.lng, destination.lat, destination.lon);

  if (distance <= CONFIG.ARRIVAL_RADIUS_M) {
    if (!store.get("navigation.arrived")) {
      store.set("navigation.arrived", true);
      store.set("navigation.instruction", "🎉 Vous êtes arrivé !");
    }
    return;
  }

  store.set("navigation.arrived", false);
  store.set("navigation.instruction", `${formatDistance(distance)} restants`);
}

/** Marque le point de destination courant comme visité et referme la navigation. */
export async function markArrivedVisited() {
  const destination = store.get("navigation.destination");
  if (!destination) return;

  const { updatePointVisit } = await import("../../db/database.js");
  await updatePointVisit(destination.id, true, destination.status);

  const points = store.get("points").map(p =>
    p.id === destination.id ? { ...p, visited: true } : p
  );
  store.set("points", points);

  const { refreshMarker } = await import("../census/markers.js");
  refreshMarker(destination.id);

  store.set("navigation.arrived", false);
  store.set("navigation.active", false);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  store.set("navigation.arrived", false);
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
