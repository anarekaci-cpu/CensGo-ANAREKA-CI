import { store } from "../../core/store.js";
import { calculateRoute, displayRoute, clearRoute, formatDuration, formatDistance } from "../routing/routing.js";
import { flyToPoint } from "../map/map.js";
import { updatePointVisit } from "../../db/database.js";
import { CONFIG } from "../../core/config.js";

let activeRoute = null;
let navInterval = null;

export function initNavigation() {
  // Écouter les changements de destination
  store.subscribe("navigation.destination", (dest) => {
    if (dest) startNavigation(dest);
  });

  store.subscribe("navigation.active", (active) => {
    if (!active) stopNavigation();
  });
}

async function startNavigation(destination) {
  const pos = store.get("geo.position");
  if (!pos) {
    store.set("ui.error", "Position GPS requise pour la navigation");
    return;
  }

  try {
    store.set("ui.loading", true);
    const route = await calculateRoute(pos.lat, pos.lng, destination.lat, destination.lon);

    displayRoute(route.geometry);
    activeRoute = route;

    store.set("navigation.route", route);
    store.set("navigation.instruction", `→ ${destination.name} — ${formatDistance(route.distance)} — ${formatDuration(route.duration)}`);
    store.set("ui.loading", false);

    // Démarrer le suivi d'arrivée
    navInterval = setInterval(() => checkArrival(destination), 3000);

  } catch (err) {
    store.set("ui.error", err.message);
    store.set("ui.loading", false);
  }
}

function stopNavigation() {
  if (navInterval) {
    clearInterval(navInterval);
    navInterval = null;
  }
  clearRoute();
  activeRoute = null;
  store.set("navigation.destination", null);
}

function checkArrival(destination) {
  const pos = store.get("geo.position");
  if (!pos || !destination) return;

  const dist = haversineM(pos.lat, pos.lng, destination.lat, destination.lon);

  if (dist <= CONFIG.ARRIVAL_RADIUS_M) {
    store.set("navigation.arrived", true);
    store.set("navigation.instruction", `🎉 Vous êtes arrivé à ${destination.name}!`);
    clearInterval(navInterval);
    navInterval = null;
  }
}

export async function markArrivedVisited() {
  const dest = store.get("navigation.destination");
  if (!dest) return;

  await updatePointVisit(dest.id, true, dest.status);

  const points = store.get("points").map(p => 
    p.id === dest.id ? { ...p, visited: true } : p
  );
  store.set("points", points);

  stopNavigation();
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
