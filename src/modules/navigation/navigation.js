import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import {
  calculateRoute,
  displayRoute,
  clearRoute,
  formatDuration,
  formatDistance,
  showRouteDestination
} from "../routing/routing.js";
import { updatePointVisit } from "../../db/database.js";
import { refreshMarker } from "../census/markers.js";
import { normalizePointId } from "../../core/utils.js";
import { toastWarning, toastInfo } from "../../core/toast.js";
import { log } from "../../core/debug.js";
import { flyToPoint } from "../map/map.js";

let navUnsubs = [];
let gpsWaitToastShown = false;
let osrmRequestCount = 0;
let pendingNavFrame = null;

/**
 * Mode de navigation actuellement sélectionné.
 *
 * IMPORTANT :
 * Le module routing actuel utilise encore OSRM "foot".
 * On mémorise donc le mode ici sans prétendre modifier le profil
 * de calcul tant que routing.js n'est pas adapté.
 */
let navigationMode = "foot";

/**
 * Initialise les abonnements qui pilotent la navigation.
 */
export function initNavigation() {
  navUnsubs.forEach(unsub => unsub());
  navUnsubs = [];

  navUnsubs.push(
    store.subscribe("navigation.active", (active) => {
      if (active) {
        scheduleStartNavigation();
      } else {
        if (pendingNavFrame) {
          cancelAnimationFrame(pendingNavFrame);
          pendingNavFrame = null;
        }

        clearRoute();
      }
    })
  );

  navUnsubs.push(
    store.subscribe("navigation.destination", () => {
      if (store.get("navigation.active")) {
        scheduleStartNavigation();
      }
    })
  );

  navUnsubs.push(
    store.subscribe("geo.position", (position) => {
      if (!store.get("navigation.active") || !position) return;

      /*
       * Si le GPS était absent au moment du premier clic,
       * on attend le premier fix puis on lance l'itinéraire.
       */
      if (!store.get("navigation.route")) {
        gpsWaitToastShown = false;
        startNavigation();
      } else {
        updateNavigationProgress(position);
      }
    })
  );
}

/**
 * Change le mode d'affichage/navigation.
 *
 * Le routing.js actuel calcule encore les itinéraires avec le profil
 * "foot". Cette fonction prépare néanmoins correctement l'état central
 * afin que le profil OSRM puisse être rendu configurable ensuite.
 *
 * @param {"foot"|"bike"|"car"} mode
 */
export function setNavigationMode(mode) {
  const allowedModes = new Set(["foot", "bike", "car"]);

  if (!allowedModes.has(mode)) {
    log.warn?.("ROUTE", `Mode de navigation inconnu: ${mode}`);
    return navigationMode;
  }

  navigationMode = mode;

  /*
   * On conserve aussi le mode dans le store.
   * Le store actuel n'impose pas de schéma strict, donc cette propriété
   * peut être ajoutée sans casser l'état existant.
   */
  store.set("navigation.mode", navigationMode);

  updateNavigationModeUI();

  /*
   * Si une navigation est déjà active, on recalcule la route.
   * Pour le moment, routing.js utilise encore le profil piéton.
   */
  if (store.get("navigation.active")) {
    const currentRoute = store.get("navigation.route");

    if (currentRoute) {
      clearRoute();
    }

    scheduleStartNavigation();
  }

  log.info("ROUTE", `Mode de navigation sélectionné: ${navigationMode}`);

  return navigationMode;
}

/**
 * Retourne le mode courant.
 */
export function getNavigationMode() {
  return navigationMode;
}

/**
 * Met à jour l'état visuel des boutons de mode.
 */
function updateNavigationModeUI() {
  if (typeof document === "undefined") return;

  document.querySelectorAll(".nav-mode-btn").forEach((button) => {
    const isActive = button.dataset.mode === navigationMode;

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const icon = document.getElementById("navIcon");

  if (icon) {
    const icons = {
      foot: "🚶",
      bike: "🚲",
      car: "🚗"
    };

    icon.textContent = icons[navigationMode] || "🚶";
  }
}

/**
 * Recentre la carte sur la dernière position GPS connue.
 */
export function recenterNavigation() {
  const position = store.get("geo.position");

  if (!position) {
    toastWarning(
      "Position actuelle indisponible. Activez la localisation puis réessayez."
    );

    return false;
  }

  const lat = Number(position.lat);
  const lng = Number(position.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    toastWarning("Position GPS invalide.");
    return false;
  }

  /*
   * flyToPoint attend (lat, lon).
   */
  flyToPoint(lat, lng, 17);

  log.info(
    "ROUTE",
    `Carte recentrée sur la position GPS [${lat}, ${lng}]`
  );

  return true;
}

function scheduleStartNavigation() {
  if (pendingNavFrame) {
    cancelAnimationFrame(pendingNavFrame);
  }

  /*
   * requestAnimationFrame n'existe pas dans certains environnements
   * de test Node. Le fallback évite un crash des tests.
   */
  if (typeof requestAnimationFrame === "function") {
    pendingNavFrame = requestAnimationFrame(() => {
      pendingNavFrame = null;
      startNavigation();
    });
  } else {
    pendingNavFrame = setTimeout(() => {
      pendingNavFrame = null;
      startNavigation();
    }, 0);
  }
}

async function startNavigation() {
  const destination = store.get("navigation.destination");

  log.trace(
    "ROUTE",
    "startNavigation START destination =",
    destination?.name
  );

  if (!destination) {
    log.trace("ROUTE", "STOP: aucune destination");
    return;
  }

  log.trace(
    "ROUTE",
    `destination = [${destination.lat}, ${destination.lon}]`
  );

  const position = store.get("geo.position");

  log.trace(
    "ROUTE",
    "currentPosition =",
    position
      ? `[${position.lat}, ${position.lng}]`
      : "null"
  );

  if (!position) {
    /*
     * Position GPS absente : on attend le prochain fix.
     */
    log.trace(
      "ROUTE",
      "STOP: GPS absent — calcul en attente de fix"
    );

    store.set(
      "navigation.instruction",
      "📍 Position actuelle indisponible. Activez la localisation pour calculer l'itinéraire."
    );

    if (!gpsWaitToastShown) {
      gpsWaitToastShown = true;

      toastWarning(
        "Position actuelle indisponible. Activez la localisation pour calculer l'itinéraire."
      );
    }

    return;
  }

  store.set(
    "navigation.instruction",
    "⏳ Calcul de l'itinéraire..."
  );

  osrmRequestCount++;

  log.trace(
    "ROUTE",
    `mode = ${navigationMode}\n` +
      `destination = ${destination.name} (${destination.lat}, ${destination.lon})\n` +
      `GPS = [${position.lat}, ${position.lng}]\n` +
      `OSRM requests = ${osrmRequestCount}`
  );

  try {
    /*
     * Le routing.js actuel utilise encore OSRM "foot".
     * On garde ici exactement sa signature actuelle pour éviter
     * de casser le calcul existant.
     */
    const route = await calculateRoute(
      position.lat,
      position.lng,
      destination.lat,
      destination.lon
    );

    log.trace(
      "ROUTE",
      "geometry =",
      route.geometry?.coordinates?.length,
      "points"
    );

    store.set("navigation.route", route);

    showRouteDestination(
      destination.lat,
      destination.lon
    );

    displayRoute(route.geometry);

    store.set(
      "navigation.instruction",
      `${formatDistance(route.distance)} — ${formatDuration(route.duration)}`
    );

    log.trace(
      "ROUTE",
      "END: route affichée + fitBounds demandé"
    );
  } catch (err) {
    log.error(
      "ROUTE",
      "échec calcul:",
      err?.message || err
    );

    log.trace(
      "ROUTE",
      "STOP: erreur =",
      err?.message || err
    );

    store.set(
      "navigation.instruction",
      "⚠️ Itinéraire indisponible — vérifiez votre connexion"
    );
  }
}

function updateNavigationProgress(position) {
  const destination = store.get("navigation.destination");

  if (!destination) return;

  const distance = haversineMeters(
    position.lat,
    position.lng,
    destination.lat,
    destination.lon
  );

  if (distance <= CONFIG.ARRIVAL_RADIUS_M) {
    if (!store.get("navigation.arrived")) {
      store.set("navigation.arrived", true);
      store.set(
        "navigation.instruction",
        "🎉 Vous êtes arrivé !"
      );
    }

    return;
  }

  store.set("navigation.arrived", false);

  store.set(
    "navigation.instruction",
    `${formatDistance(distance)} restants`
  );
}

/**
 * Marque le point de destination courant comme visité
 * et ferme la navigation.
 */
export async function markArrivedVisited() {
  const destination = store.get("navigation.destination");

  if (!destination) return;

  await updatePointVisit(
    destination.id,
    true,
    destination.status
  );

  const pid = normalizePointId(destination.id);

  const points = (store.get("points") || []).map((point) =>
    normalizePointId(point.id) === pid
      ? { ...point, visited: true }
      : point
  );

  store.set("points", points);

  refreshMarker(pid);

  clearRoute();

  store.set("navigation.arrived", false);
  store.set("navigation.active", false);
}

/**
 * Distance entre deux coordonnées GPS en mètres.
 */
function haversineMeters(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371000;

  const dLat =
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}
