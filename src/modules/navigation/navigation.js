import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { calculateRoute, displayRoute, clearRoute, formatDuration, formatDistance } from "../routing/routing.js";
import { updatePointVisit } from "../../db/database.js";
import { refreshMarker } from "../census/markers.js";

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

  // Un nouveau clic sur "Itinéraire" pendant qu'une navigation est déjà active
  // ne fait que changer la destination (navigation.active reste déjà à true et
  // ne redéclenche donc pas l'abonnement ci-dessus) — sans ceci l'itinéraire
  // restait figé sur le premier point choisi.
  navUnsubs.push(store.subscribe("navigation.destination", () => {
    if (store.get("navigation.active")) startNavigation();
  }));

  navUnsubs.push(store.subscribe("geo.position", (position) => {
    if (!store.get("navigation.active") || !position) return;
    // Le calcul initial attendait une position déjà connue et abandonnait
    // silencieusement si le GPS n'avait pas encore de fix (cas fréquent au
    // premier clic) : dès qu'une position arrive, on calcule enfin l'itinéraire
    // au lieu de rester bloqué sans aucun message.
    if (!store.get("navigation.route")) {
      startNavigation();
    } else {
      updateNavigationProgress(position);
    }
  }));
}

async function startNavigation() {
  const destination = store.get("navigation.destination");
  if (!destination) return;

  const position = store.get("geo.position");
  if (!position) {
    store.set("navigation.instruction", "📍 En attente de votre position GPS...");
    return;
  }

  store.set("navigation.instruction", "⏳ Calcul de l'itinéraire...");
  try {
    const route = await calculateRoute(position.lat, position.lng, destination.lat, destination.lon);
    store.set("navigation.route", route);
    displayRoute(route.geometry);
    store.set("navigation.instruction", `${formatDistance(route.distance)} — ${formatDuration(route.duration)}`);
  } catch (err) {
    store.set("navigation.instruction", "⚠️ Itinéraire indisponible — vérifiez votre connexion");
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

  await updatePointVisit(destination.id, true, destination.status);

  const points = store.get("points").map(p =>
    p.id === destination.id ? { ...p, visited: true } : p
  );
  store.set("points", points);

  refreshMarker(destination.id);

  clearRoute();
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
