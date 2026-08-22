import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { calculateRoute, displayRoute, clearRoute, formatDuration, formatDistance, showRouteDestination } from "../routing/routing.js";
import { updatePointVisit } from "../../db/database.js";
import { refreshMarker } from "../census/markers.js";
import { normalizePointId } from "../../core/utils.js";
import { toastWarning } from "../../core/toast.js";
import { log } from "../../core/debug.js";

let navUnsubs = [];
let gpsWaitToastShown = false;
let osrmRequestCount = 0;

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
      scheduleStartNavigation();
    } else {
      if (pendingNavFrame) {
        cancelAnimationFrame(pendingNavFrame);
        pendingNavFrame = null;
      }
      clearRoute();
    }
  }));

  navUnsubs.push(store.subscribe("navigation.destination", () => {
    if (store.get("navigation.active")) scheduleStartNavigation();
  }));

  navUnsubs.push(store.subscribe("geo.position", (position) => {
    if (!store.get("navigation.active") || !position) return;
    // Le calcul initial attendait une position déjà connue et abandonnait
    // silencieusement si le GPS n'avait pas de fix (cas fréquent au premier
    // clic) : dès qu'une position arrive, on calcule enfin l'itinéraire.
    if (!store.get("navigation.route")) {
      gpsWaitToastShown = false;
      startNavigation();
    } else {
      updateNavigationProgress(position);
    }
  }));
}

let pendingNavFrame = null;

function scheduleStartNavigation() {
  if (pendingNavFrame) cancelAnimationFrame(pendingNavFrame);
  pendingNavFrame = requestAnimationFrame(() => {
    pendingNavFrame = null;
    startNavigation();
  });
}

async function startNavigation() {
  const destination = store.get("navigation.destination");
  log.trace("ROUTE", "startNavigation START destination =", destination?.name);
  if (!destination) {
    log.trace("ROUTE", "STOP: aucune destination");
    return;
  }

  log.trace("ROUTE", `destination = [${destination.lat}, ${destination.lon}]`);
  const position = store.get("geo.position");
  log.trace("ROUTE", "currentPosition =", position ? `[${position.lat}, ${position.lng}]` : "null");
  if (!position) {
    // Cas D : position GPS absente — erreur CLAIRE (Problème #7) au lieu
    // d'un silence. Le calcul partira automatiquement dès la première
    // position GPS reçue (abonnement geo.position ci-dessus).
    log.trace("ROUTE", "STOP: GPS absent — message affiché, calcul en attente de fix");
    store.set("navigation.instruction", "📍 Position actuelle indisponible. Activez la localisation pour calculer l'itinéraire.");
    if (!gpsWaitToastShown) {
      gpsWaitToastShown = true;
      toastWarning("Position actuelle indisponible. Activez la localisation pour calculer l'itinéraire.");
    }
    return;
  }

  store.set("navigation.instruction", "⏳ Calcul de l'itinéraire...");
  osrmRequestCount++;
  console.log(`[DEBUG][ROUTE]\nclick = true\ndestination = ${destination.name} (${destination.lat}, ${destination.lon})\nGPS = [${position.lat}, ${position.lng}]\nOSRM requests = ${osrmRequestCount}`);

  try {
    const route = await calculateRoute(position.lat, position.lng, destination.lat, destination.lon);
    log.trace("ROUTE", "geometry =", route.geometry?.coordinates?.length, "points");
    store.set("navigation.route", route);
    showRouteDestination(destination.lat, destination.lon);
    displayRoute(route.geometry);
    store.set("navigation.instruction", `${formatDistance(route.distance)} — ${formatDuration(route.duration)}`);
    log.trace("ROUTE", "END: route affichée + fitBounds demandé");
  } catch (err) {
    log.trace("ROUTE", "STOP: échec calcul —", err.message);
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

  const pid = normalizePointId(destination.id);
  const points = (store.get("points") || []).map(p =>
    normalizePointId(p.id) === pid ? { ...p, visited: true } : p
  );
  store.set("points", points);

  refreshMarker(pid);

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
