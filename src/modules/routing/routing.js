import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import {
  addRouteLayer,
  clearRouteLayers,
  fitRouteBounds,
  showDestinationMarker,
  hideDestinationMarker
} from "../map/map.js";
import { isValidLatLng } from "../../core/normalize.js";
import { haversineKm } from "../../core/geo.js";
import { log } from "../../core/debug.js";

/**
 * Métadonnées des modes de navigation.
 *
 * Le serveur OSRM configuré pour ce projet (CONFIG.OSRM_URL) n'expose
 * qu'un seul profil de routage, "foot" (voir SECURITY.md / historique) —
 * interroger /route/v1/bike/ ou /route/v1/car/ sur ce même serveur
 * renverrait soit une erreur, soit (pire, silencieusement) le même
 * itinéraire piéton mal étiqueté "vélo"/"véhicule". calculateRoute()
 * interroge donc toujours le profil "foot" pour obtenir une géométrie et
 * une distance réelles (suivant les voies).
 *
 * BUG CONFIRMÉ EN PRODUCTION : la durée renvoyée par ce serveur pour le
 * profil "foot" n'est PAS un temps de marche — un trajet de 20,8 km a été
 * renvoyé avec duration=27min, soit ~46 km/h (vitesse voiture, pas
 * piéton). Le serveur ne calcule donc pas de vraie durée piétonne malgré
 * le nom du profil dans l'URL. La durée n'est JAMAIS prise depuis la
 * réponse OSRM, pour aucun mode : elle est systématiquement dérivée de
 * la distance réelle (routée) et d'une vitesse moyenne par mode
 * (AVERAGE_SPEEDS_MPS) — voir calculateRoute().
 */
export const NAV_MODES = {
  foot: {
    id: "foot",
    label: "À pied",
    icon: "🚶",
    profile: "foot"
  },

  bike: {
    id: "bike",
    label: "À vélo",
    icon: "🚲",
    profile: "foot"
  },

  car: {
    id: "car",
    label: "En véhicule",
    icon: "🚗",
    profile: "foot"
  }
};

/**
 * Vitesses moyennes (m/s) utilisées pour dériver une durée par mode à
 * partir d'une distance réelle (route OSRM ou estimation à vol d'oiseau).
 */
const AVERAGE_SPEEDS_MPS = {
  foot: 1.4,   // ≈ 5 km/h
  bike: 4.2,   // ≈ 15 km/h
  car: 11.1    // ≈ 40 km/h — prudent en zone urbaine/piste non bitumée
};

/**
 * Indique si `mode` est un mode de navigation connu.
 *
 * @param {unknown} mode
 * @returns {boolean}
 */
export function isValidNavMode(mode) {
  return Object.prototype.hasOwnProperty.call(NAV_MODES, mode);
}

/**
 * Retourne les informations d'un mode de navigation.
 *
 * @param {"foot"|"bike"|"car"} mode
 * @returns {{id:string,label:string,icon:string,profile:string}}
 */
export function getModeMeta(mode = "foot") {
  return NAV_MODES[mode] || NAV_MODES.foot;
}

/**
 * Retourne tous les modes disponibles.
 */
export function getAvailableModes() {
  return Object.values(NAV_MODES);
}

/**
 * Calcule un itinéraire via OSRM.
 *
 * Ordre des arguments :
 * (lat, lng) côté appelant.
 *
 * OSRM attend :
 * (lng, lat).
 *
 * @param {"foot"|"bike"|"car"} [mode] mode de navigation ; retombe sur
 * "foot" si absent ou inconnu.
 */
export async function calculateRoute(
  fromLat,
  fromLng,
  toLat,
  toLng,
  mode
) {
  const resolvedMode = isValidNavMode(mode) ? mode : "foot";

  log.trace("ROUTE", "request START");

  log.trace(
    "ROUTE",
    `origin = [${fromLat}, ${fromLng}] destination = [${toLat}, ${toLng}]`
  );

  log.trace(
    "ROUTE",
    "provider = OSRM (CONFIG.OSRM_URL)"
  );

  /*
   * Validation avant tout appel réseau.
   */
  if (
    !isValidLatLng(fromLat, fromLng) ||
    !isValidLatLng(toLat, toLng)
  ) {
    log.error(
      "ROUTE",
      `coordonnées invalides origin=(${fromLat},${fromLng}) destination=(${toLat},${toLng})`
    );

    log.trace(
      "ROUTE",
      "STOP: validation coordonnées échouée"
    );

    throw new Error(
      "Coordonnées invalides pour le calcul d'itinéraire"
    );
  }

  // Toujours le profil "foot" réel du serveur — voir le commentaire sur
  // NAV_MODES plus haut. La durée est recalculée plus bas selon le mode.
  const profile = NAV_MODES.foot.profile;

  const url =
    `${CONFIG.OSRM_URL}/route/v1/${profile}/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&steps=true`;

  log.info(
    "ROUTE",
    `request started origin=[${fromLat},${fromLng}] destination=[${toLat},${toLng}]`
  );

  log.trace(
    "ROUTE",
    "request URL =",
    url
  );

  try {
    const res = await fetch(url);

    log.debug(
      "ROUTE",
      `response ${res.status}`
    );

    log.trace(
      "ROUTE",
      "response STATUS =",
      res.status
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (
      data.code !== "Ok" ||
      !data.routes?.[0]
    ) {
      log.trace(
        "ROUTE",
        "STOP: réponse OSRM code =",
        data.code,
        "(routes vides ?)"
      );

      throw new Error(
        "Itinéraire impossible"
      );
    }

    const route = data.routes[0];

    log.info(
      "ROUTE",
      `geometry received ${
        route.geometry?.coordinates?.length || 0
      } points`,
      `${Math.round(route.distance)}m / ${Math.round(route.duration)}s`
    );

    log.trace(
      "ROUTE",
      `responseStatus = ${res.status}
geometry = ${route.geometry?.coordinates?.length || 0} pts
mapSourceExists = true
mapLayerExists = true
routeVisible = true`
    );

    // route.duration N'EST PAS FIABLE, y compris pour "foot" (voir le
    // commentaire sur NAV_MODES plus haut — confirmé en production : un
    // trajet piéton de 20,8 km renvoyé avec un temps de voiture, ~46 km/h).
    // La distance ROUTÉE (suit les voies réelles) reste fiable ; seule la
    // durée est systématiquement recalculée nous-mêmes, pour tous les modes.
    const duration = route.distance / AVERAGE_SPEEDS_MPS[resolvedMode];

    return {
      distance: route.distance,
      duration,
      geometry: route.geometry,
      steps: route.legs?.[0]?.steps || [],
      mode: resolvedMode,
      estimated: false
    };

  } catch (err) {
    log.error(
      "ROUTE",
      "échec:",
      err.message
    );

    log.trace(
      "ROUTE",
      "STOP: erreur =",
      err.message
    );

    log.trace(
      "ROUTE",
      `responseStatus = error
geometry = 0 pts
mapSourceExists = false
mapLayerExists = false
routeVisible = false`
    );

    throw err;
  }
}

/**
 * Estime un itinéraire en ligne droite quand OSRM est indisponible
 * (hors-ligne, panne réseau, timeout).
 *
 * Le résultat a la même forme que calculateRoute() (distance, duration,
 * geometry, steps) avec `estimated: true` pour signaler qu'il s'agit
 * d'une approximation et non d'un itinéraire réel.
 *
 * @param {"foot"|"bike"|"car"} [mode]
 */
export function estimateFallbackRoute(
  fromLat,
  fromLng,
  toLat,
  toLng,
  mode
) {
  const resolvedMode = isValidNavMode(mode) ? mode : "foot";

  const distance = haversineKm(fromLat, fromLng, toLat, toLng) * 1000;
  const duration = distance / AVERAGE_SPEEDS_MPS[resolvedMode];

  return {
    distance,
    duration,
    geometry: {
      type: "LineString",
      coordinates: [
        [fromLng, fromLat],
        [toLng, toLat]
      ]
    },
    steps: [],
    mode: resolvedMode,
    estimated: true
  };
}

/**
 * Affiche la géométrie de l'itinéraire sur la carte.
 */
export function displayRoute(geometry) {
  if (
    !geometry ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length === 0
  ) {
    log.warn(
      "ROUTE",
      "displayRoute: géométrie vide"
    );

    return;
  }

  clearRouteLayers();

  addRouteLayer(geometry);

  /*
   * Cadre la caméra sur l'ensemble du trajet.
   */
  fitRouteBounds(geometry);
}

/**
 * Affiche le marqueur de destination.
 */
export function showRouteDestination(lat, lon) {
  if (
    !isValidLatLng(lat, lon)
  ) {
    log.warn(
      "ROUTE",
      "showRouteDestination: coordonnées invalides"
    );

    return;
  }

  showDestinationMarker(
    lat,
    lon
  );
}

/**
 * Masque le marqueur de destination.
 */
export function hideRouteDestination() {
  hideDestinationMarker();
}

/**
 * Supprime l'itinéraire actuellement affiché.
 */
export function clearRoute() {
  clearRouteLayers();

  hideDestinationMarker();

  store.set(
    "navigation.route",
    null
  );

  store.set(
    "navigation.instruction",
    ""
  );
}

const MANEUVER_VERBS = {
  "new name": "Continuez",
  merge: "Rejoignez la voie",
  "on ramp": "Prenez la bretelle",
  "off ramp": "Sortez",
  fork: "Restez",
  "end of road": "Au bout de la route, tournez",
  continue: "Continuez",
  roundabout: "Au rond-point, prenez la sortie",
  rotary: "Au rond-point, prenez la sortie",
  "roundabout turn": "Au rond-point, tournez"
};

const MODIFIER_LABELS = {
  uturn: "faites demi-tour",
  "sharp right": "fortement à droite",
  right: "à droite",
  "slight right": "légèrement à droite",
  straight: "tout droit",
  "slight left": "légèrement à gauche",
  left: "à gauche",
  "sharp left": "fortement à gauche"
};

/**
 * Formate un pas de guidage OSRM (route.steps[i]) en instruction lisible.
 *
 * @param {{maneuver?:{type?:string,modifier?:string}, name?:string}} step
 * @returns {string} instruction en français, ou "" si step est invalide
 */
export function formatManeuverInstruction(step) {
  if (!step?.maneuver) return "";

  const { type, modifier } = step.maneuver;
  const streetName = step.name?.trim();

  if (type === "arrive") return "🏁 Vous êtes arrivé à destination";
  if (type === "depart") {
    return streetName ? `🚦 Départ sur ${streetName}` : "🚦 Départ";
  }

  const verb = MANEUVER_VERBS[type] || "Continuez";
  const dir = modifier ? MODIFIER_LABELS[modifier] : "";
  const onStreet = streetName ? ` sur ${streetName}` : "";

  return `${verb}${dir ? " " + dir : ""}${onStreet}`.trim();
}

/**
 * Formate une durée en secondes.
 */
export function formatDuration(seconds) {
  const value = Number(seconds);

  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return "—";
  }

  const m = Math.round(
    value / 60
  );

  if (m < 60) {
    return `${m} min`;
  }

  const h = Math.floor(
    m / 60
  );

  const rm = m % 60;

  return `${h}h ${rm}min`;
}

/**
 * Formate une distance en mètres.
 */
export function formatDistance(meters) {
  const value = Number(meters);

  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return "—";
  }

  if (value < 1000) {
    return `${Math.round(value)} m`;
  }

  return `${(
    value / 1000
  ).toFixed(1)} km`;
}
