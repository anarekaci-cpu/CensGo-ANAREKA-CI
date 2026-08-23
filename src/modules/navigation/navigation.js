import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import {
  calculateRoute,
  estimateFallbackRoute,
  displayRoute,
  clearRoute,
  formatDuration,
  formatDistance,
  formatManeuverInstruction,
  showRouteDestination
} from "../routing/routing.js";
import { updatePointVisit } from "../../db/database.js";
import { refreshMarker } from "../census/markers.js";
import { normalizePointId } from "../../core/utils.js";
import { distanceToPolylineMeters, bearingDeg, cardinalLabel } from "../../core/geo.js";
import { speak, cancelSpeech } from "../../core/speech.js";
import { toastWarning } from "../../core/toast.js";
import { log } from "../../core/debug.js";
import { flyToPoint } from "../map/map.js";

let navUnsubs = [];
let gpsWaitToastShown = false;
let osrmRequestCount = 0;
let pendingNavFrame = null;

// Guidage pas-à-pas : steps OSRM de l'itinéraire actif + index du prochain
// maneuver à annoncer.
let currentSteps = [];
let currentStepIndex = 0;

// Détection d'écart de tracé (agent qui quitte la route calculée) :
// géométrie de l'itinéraire actif + garde-fou anti-spam sur le recalcul.
let currentRouteCoords = null;
let lastRerouteAt = 0;

// Distance (m) au-delà de laquelle la position GPS est considérée hors
// tracé — au-delà, l'itinéraire est recalculé depuis la position actuelle
// plutôt que de continuer à afficher un chemin que l'agent n'a plus suivi.
const OFF_ROUTE_THRESHOLD_M = 40;
// Anti-spam : un recalcul OSRM au minimum toutes les 15s, même si le GPS
// continue de signaler une position hors tracé à chaque fix.
const REROUTE_DEBOUNCE_MS = 15000;
// Distance (m) sous laquelle le prochain maneuver OSRM est considéré
// "atteint" et le guidage passe au pas suivant.
const STEP_ADVANCE_RADIUS_M = 20;

/**
 * Mode de navigation actuellement sélectionné (transmis à calculateRoute
 * pour sélectionner le profil OSRM foot/bike/car).
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

        currentSteps = [];
        currentStepIndex = 0;
        currentRouteCoords = null;
        cancelSpeech();

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

  // Guidage vocal : store.set() ne notifie que sur un changement de valeur
  // (core/store.js), donc ces abonnements ne se déclenchent naturellement
  // qu'au passage à un NOUVEAU maneuver / à l'arrivée — pas à chaque fix
  // GPS, même si l'appelant réécrit la même valeur en boucle.
  navUnsubs.push(
    store.subscribe("navigation.nextInstruction", (text) => {
      if (text) speak(text);
    })
  );

  navUnsubs.push(
    store.subscribe("navigation.arrived", (arrived) => {
      if (arrived) speak("Vous êtes arrivé à destination");
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
 * Change le mode de navigation et recalcule l'itinéraire actif avec le
 * profil OSRM correspondant.
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
   * Si une navigation est déjà active, on recalcule la route avec
   * le nouveau profil OSRM.
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
    const route = await calculateRoute(
      position.lat,
      position.lng,
      destination.lat,
      destination.lon,
      navigationMode
    );

    log.trace(
      "ROUTE",
      "geometry =",
      route.geometry?.coordinates?.length,
      "points"
    );

    store.set("navigation.route", route);

    currentSteps = route.steps || [];
    currentStepIndex = 0;
    currentRouteCoords = route.geometry?.coordinates || null;
    lastRerouteAt = Date.now();

    showRouteDestination(
      destination.lat,
      destination.lon
    );

    displayRoute(route.geometry);

    store.set(
      "navigation.instruction",
      `${formatDistance(route.distance)} — ${formatDuration(route.duration)}`
    );

    store.set(
      "navigation.nextInstruction",
      currentSteps[0] ? formatManeuverInstruction(currentSteps[0]) : ""
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

    // Mode offline (#26/README "Mode offline complet") : un échec OSRM
    // (hors-ligne, timeout, coupure réseau terrain) laissait l'agent sans
    // AUCUN guidage — juste un message d'erreur, ni tracé ni distance. On
    // retombe sur une estimation à vol d'oiseau (estimateFallbackRoute) :
    // moins précise qu'un vrai itinéraire routier mais toujours exploitable
    // pour s'orienter. maybeReroute() retente un calcul OSRM réel à chaque
    // déplacement (debounce 15s) et remplace automatiquement l'estimation
    // dès que la connexion revient.
    const fallback = estimateFallbackRoute(
      position.lat,
      position.lng,
      destination.lat,
      destination.lon,
      navigationMode
    );

    store.set("navigation.route", fallback);
    currentSteps = [];
    currentStepIndex = 0;
    currentRouteCoords = fallback.geometry.coordinates;
    lastRerouteAt = Date.now();

    showRouteDestination(destination.lat, destination.lon);
    displayRoute(fallback.geometry);

    // Sans tracé routier réel, la distance seule ne dit pas où marcher —
    // le cap (déjà calculé pour la boussole terrain, core/geo.js) donne au
    // moins une direction cardinale exploitable à l'oeil nu.
    const bearing = bearingDeg(position.lat, position.lng, destination.lat, destination.lon);
    const direction = cardinalLabel(bearing);

    store.set(
      "navigation.instruction",
      `≈ ${formatDistance(fallback.distance)} — ${formatDuration(fallback.duration)} (estimation, hors-ligne)`
    );
    store.set(
      "navigation.nextInstruction",
      `📶 Itinéraire précis indisponible — cap ${direction} (${Math.round(bearing)}°)`
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
      store.set("navigation.nextInstruction", "");
    }

    return;
  }

  store.set("navigation.arrived", false);

  store.set(
    "navigation.instruction",
    `${formatDistance(distance)} restants`
  );

  advanceGuidanceSteps(position);
  maybeReroute(position);
}

/**
 * Guidage pas-à-pas : fait avancer l'index du prochain maneuver OSRM quand
 * l'agent a dépassé le point du maneuver courant, et publie l'instruction
 * suivante (navigation.nextInstruction, affiché sous l'instruction
 * principale dans #navPanel — voir appView.js).
 */
function advanceGuidanceSteps(position) {
  if (!currentSteps.length) return;

  while (currentStepIndex < currentSteps.length) {
    const loc = currentSteps[currentStepIndex]?.maneuver?.location;
    if (!loc) break;

    const distToStep = haversineMeters(position.lat, position.lng, loc[1], loc[0]);
    if (distToStep > STEP_ADVANCE_RADIUS_M) break;

    currentStepIndex++;
  }

  const nextStep = currentSteps[currentStepIndex];
  store.set(
    "navigation.nextInstruction",
    nextStep ? formatManeuverInstruction(nextStep) : ""
  );
}

/**
 * Recalcule l'itinéraire quand la position GPS s'écarte trop du tracé
 * affiché (agent parti dans une autre direction, route bloquée...) — sans
 * ça, #navPanel continuait d'afficher un chemin obsolète et une distance
 * "restante" qui ne correspondait plus au trajet réellement suivi.
 */
function maybeReroute(position) {
  if (!currentRouteCoords) return;

  const deviation = distanceToPolylineMeters(
    position.lat,
    position.lng,
    currentRouteCoords
  );

  if (deviation <= OFF_ROUTE_THRESHOLD_M) return;
  if (Date.now() - lastRerouteAt < REROUTE_DEBOUNCE_MS) return;

  log.info("ROUTE", `écart de tracé détecté (${Math.round(deviation)}m) — recalcul de l'itinéraire`);
  lastRerouteAt = Date.now();
  startNavigation();
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
