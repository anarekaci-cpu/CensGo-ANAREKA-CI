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
import { getHeuristicCarSpeedMps } from "./trafficHeuristic.js";
import { getTrafficFactor } from "./trafficHeuristic.js";

/**
 * Métadonnées des modes de navigation.
 *
 * Itinéraires réels par mode (Priorité 1 roadmap) : calculateRoute()
 * interroge d'abord OpenRouteService (CONFIG.ORS_API_KEY, un vrai profil
 * par mode — foot-walking/cycling-regular/driving-car, voir ORS_PROFILES)
 * quand une clé est configurée. Sans clé, ou si ORS échoue (quota, réseau,
 * panne), repli automatique sur OSRM (CONFIG.OSRM_URL).
 *
 * Le serveur OSRM configuré pour ce projet n'expose lui qu'un SEUL profil
 * de routage, "foot" (voir SECURITY.md / historique) — interroger
 * /route/v1/bike/ ou /route/v1/car/ sur ce même serveur renverrait soit une
 * erreur, soit (pire, silencieusement) le même itinéraire piéton mal
 * étiqueté "vélo"/"véhicule". Le repli OSRM interroge donc toujours le
 * profil "foot" pour obtenir une géométrie et une distance réelles (suivant
 * les voies), peu importe le mode demandé.
 *
 * BUG CONFIRMÉ EN PRODUCTION (repli OSRM uniquement) : la durée renvoyée
 * par ce serveur pour le profil "foot" n'est PAS un temps de marche — un
 * trajet de 20,8 km a été renvoyé avec duration=27min, soit ~46 km/h
 * (vitesse voiture, pas piéton). La durée OSRM n'est donc JAMAIS réutilisée
 * telle quelle, pour aucun mode : elle est systématiquement dérivée de la
 * distance réelle (routée) et d'une vitesse moyenne par mode
 * (AVERAGE_SPEEDS_MPS) — voir calculateRoute(). ORS, lui, renvoie une vraie
 * durée par profil et celle-ci est utilisée directement (ajustée par le
 * trafic heuristique pour le mode voiture, voir trafficHeuristic.js).
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
 * Vitesse moyenne effective pour `mode`, ajustée par le trafic heuristique
 * (mode voiture uniquement — voir modules/traffic/trafficHeuristic.js).
 */
function resolveAverageSpeedMps(mode) {
  const base = AVERAGE_SPEEDS_MPS[mode];
  return mode === "car" ? getHeuristicCarSpeedMps(base) : base;
}

/** Profils OpenRouteService — un vrai profil distinct par mode (voir NAV_MODES). */
const ORS_PROFILES = {
  foot: "foot-walking",
  bike: "cycling-regular",
  car: "driving-car"
};

/**
 * Calcule un itinéraire réel via OpenRouteService pour le profil exact du
 * mode demandé (contrairement au repli OSRM, toujours "foot" — voir
 * commentaire NAV_MODES). Lève en cas d'échec (réseau, quota, clé
 * invalide) : à l'appelant (calculateRoute()) de retomber sur OSRM.
 */
function parseORSFeature(feature, mode, date = new Date()) {
  const summary = feature?.properties?.summary;
  const geometry = feature?.geometry;
  if (!feature || !summary || !geometry?.coordinates?.length) return null;
  const steps = (feature.properties?.segments?.[0]?.steps || []).map(s => ({
    instruction: s.instruction,
    name: s.name,
    maneuver: { location: geometry.coordinates[s.way_points?.[0]] || null }
  }));
  const trafficFactor = mode === "car" ? getTrafficFactor(date, mode) : 1;
  return {
    distance: summary.distance,
    duration: summary.duration * trafficFactor,
    baseDuration: summary.duration,
    trafficFactor,
    geometry,
    steps,
    mode,
    estimated: false,
    provider: "ors"
  };
}

export function selectBestRoutes(routes, mode, date = new Date()) {
  const alternatives = routes.map(route => ({
    ...route,
    duration: (route.baseDuration ?? route.duration) * (mode === "car" ? getTrafficFactor(date, mode) : 1),
    trafficFactor: mode === "car" ? getTrafficFactor(date, mode) : 1
  }));
  const suggested = [...alternatives].sort((a, b) => a.duration - b.duration)[0];
  const shortest = [...alternatives].sort((a, b) => a.distance - b.distance)[0];
  return { suggested, shortest, alternatives };
}

async function calculateRouteViaORS(fromLat, fromLng, toLat, toLng, mode) {
  const profile = ORS_PROFILES[mode] || ORS_PROFILES.foot;
  const url = `${CONFIG.ORS_URL}/v2/directions/${profile}/geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: CONFIG.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [[fromLng, fromLat], [toLng, toLat]],
        instructions: true,
        language: "fr",
        alternative_routes: { target_count: 3, share_factor: 0.6 }
      }),
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const routes = (data.features || []).map(feature => parseORSFeature(feature, mode)).filter(Boolean);
    if (!routes.length) throw new Error("Itinéraire ORS impossible");
    const selected = selectBestRoutes(routes, mode);
    return { ...selected.suggested, suggested: selected.suggested, shortest: selected.shortest, alternatives: selected.alternatives, selection: "suggested" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Trouve, parmi une liste de candidats PRÉ-FILTRÉE (voir
 * findNearestUnvisited(), geolocation.js), celui le plus proche par
 * DISTANCE ROUTÉE réelle (service OSRM /table) plutôt qu'à vol d'oiseau.
 *
 * BUG CONFIRMÉ EN TERRAIN : à vol d'oiseau, un point de l'autre côté d'une
 * lagune/d'un fleuve (fréquent à Abidjan) paraît "le plus proche" alors
 * qu'il faut en réalité faire tout le tour par le pont — pendant ce
 * détour, l'agent passe devant des dizaines d'autres points non-visités
 * qui, eux, étaient vraiment les plus proches PAR LA ROUTE. Le "plus
 * proche" affiché n'avait donc souvent aucun rapport avec le trajet réel.
 *
 * @param {number} fromLat
 * @param {number} fromLng
 * @param {Array<{lat:number, lon:number}>} candidates présélection à vol
 *   d'oiseau — le service /table public a une limite pratique de
 *   coordonnées par requête, d'où la présélection en amont.
 * @returns {Promise<{index:number, distanceM:number}|null>} index dans
 *   `candidates` du plus proche par la route, ou null si la requête échoue
 *   (offline, timeout) — l'appelant doit alors retomber sur le tri à vol
 *   d'oiseau plutôt que d'échouer complètement (résilience offline-first).
 */
function logNearestCandidates(provider, candidates, distances, bestIndex, bestDistance) {
  // Diagnostic terrain (toujours affiché, pas seulement en DEBUG=1) :
  // un agent qui signale "ce n'est pas le point le plus proche" doit
  // pouvoir ouvrir la console et voir EXACTEMENT quels candidats ont été
  // comparés et pourquoi — sans ça, chaque signalement demande de
  // deviner (voir l'incident du 2026-08-29 : un point à 20 km choisi
  // alors que des dizaines d'autres semblaient plus proches sur la carte).
  log.traceAlways("GPS",
    `findNearestByRoad (${provider}) : ${candidates.length} candidat(s) comparés`,
    candidates.map((c, i) => ({
      id: c.id, name: c.name,
      distanceRouteeM: typeof distances[i] === "number" ? Math.round(distances[i]) : "inatteignable"
    })),
    bestIndex >= 0 ? `-> retenu : ${candidates[bestIndex].id} (${Math.round(bestDistance)} m)` : "-> aucun candidat atteignable"
  );
}

function bestFromDistances(distances) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  distances.forEach((d, i) => {
    // null possible : destination inatteignable par la route depuis la
    // source (île sans pont piéton connu du graphe, etc.) — ignorée
    // plutôt que de faire planter la comparaison.
    if (typeof d === "number" && d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  });
  return { bestIndex, bestDistance };
}

/**
 * Variante OpenRouteService (Matrix API) de findNearestByRoad() ci-dessous —
 * même principe qu'OSRM /table, mais un vrai graphe piéton par profil
 * (foot-walking) plutôt que le profil unique du serveur OSRM configuré (voir
 * commentaire NAV_MODES). Lève en cas d'échec (clé absente, quota, réseau) :
 * à l'appelant de retomber sur OSRM.
 */
async function findNearestByRoadViaORS(fromLat, fromLng, candidates) {
  const url = `${CONFIG.ORS_URL}/v2/matrix/${ORS_PROFILES.foot}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: CONFIG.ORS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [[fromLng, fromLat], ...candidates.map(p => [p.lon, p.lat])],
        sources: [0],
        // destinations 1..N (jamais 0, la source elle-même) : distances[0]
        // a alors exactement candidates.length entrées, dans l'ordre de
        // `candidates` — même convention que la variante OSRM ci-dessous.
        destinations: candidates.map((_, i) => i + 1),
        metrics: ["distance"]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const distances = data.distances?.[0];
    if (!Array.isArray(distances) || distances.length !== candidates.length) {
      throw new Error("Réponse ORS matrix invalide");
    }

    const { bestIndex, bestDistance } = bestFromDistances(distances);
    logNearestCandidates("ORS", candidates, distances, bestIndex, bestDistance);
    if (bestIndex === -1) return null;
    return { index: bestIndex, distanceM: bestDistance };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findNearestByRoadViaOSRM(fromLat, fromLng, candidates) {
  // Seul profil réel exposé par le serveur configuré — voir NAV_MODES.
  const profile = NAV_MODES.foot.profile;
  const coords = [
    `${fromLng},${fromLat}`,
    ...candidates.map(p => `${p.lon},${p.lat}`)
  ].join(";");
  // destinations=1;2;...;N (jamais 0, qui est la source elle-même) : la
  // réponse distances[0] a alors exactement candidates.length entrées,
  // dans le même ordre que `candidates` — aucun décalage à gérer.
  const destinations = candidates.map((_, i) => i + 1).join(";");
  const url =
    `${CONFIG.OSRM_URL}/table/v1/${profile}/${coords}` +
    `?sources=0&destinations=${destinations}&annotations=distance`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const distances = data.distances?.[0];
    if (data.code !== "Ok" || !Array.isArray(distances) || distances.length !== candidates.length) {
      throw new Error(`Réponse OSRM table invalide (code=${data.code})`);
    }

    const { bestIndex, bestDistance } = bestFromDistances(distances);
    logNearestCandidates("OSRM", candidates, distances, bestIndex, bestDistance);
    if (bestIndex === -1) return null;
    return { index: bestIndex, distanceM: bestDistance };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function findNearestByRoad(fromLat, fromLng, candidates) {
  if (!candidates.length) return null;

  // Même bascule que calculateRoute() : ORS d'abord si une clé est
  // configurée (vrai graphe piéton), repli sur OSRM sinon ou en cas
  // d'échec (quota, réseau, clé invalide) — jamais d'erreur remontée à
  // l'agent pour ce seul motif, voir l'appelant (findNearestUnvisited).
  if (CONFIG.ORS_API_KEY) {
    try {
      return await findNearestByRoadViaORS(fromLat, fromLng, candidates);
    } catch (err) {
      log.warn("ROUTE", "findNearestByRoad() ORS échoué, repli sur OSRM:", err?.message || err);
    }
  }

  try {
    return await findNearestByRoadViaOSRM(fromLat, fromLng, candidates);
  } catch (err) {
    log.warn("ROUTE", "findNearestByRoad() échoué, repli sur le vol d'oiseau:", err?.message || err);
    return null;
  }
}

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

  // Priorité 1 roadmap : un vrai profil par mode via OpenRouteService quand
  // une clé est configurée. Échec (réseau, quota, clé invalide) -> repli
  // silencieux sur OSRM ci-dessous, jamais une erreur remontée à l'agent
  // pour ce seul motif.
  if (CONFIG.ORS_API_KEY) {
    try {
      const orsRoute = await calculateRouteViaORS(fromLat, fromLng, toLat, toLng, resolvedMode);
      log.info("ROUTE", `provider=ORS profile=${ORS_PROFILES[resolvedMode]} ok`);
      return orsRoute;
    } catch (err) {
      log.warn("ROUTE", "ORS échoué, repli sur OSRM:", err?.message || err);
    }
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
    const duration = route.distance / resolveAverageSpeedMps(resolvedMode);

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
  const duration = distance / resolveAverageSpeedMps(resolvedMode);

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
 *
 * @param {object} geometry LineString GeoJSON (route.geometry)
 * @param {"foot"|"bike"|"car"} [mode] détermine le style du tracé (pointillé
 * à pied, trait plein vélo/véhicule) — voir ROUTE_LINE_STYLES dans map.js.
 */
export function displayRoute(geometry, mode) {
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

  addRouteLayer(geometry, mode);

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
  if (!step) return "";

  // Steps ORS (calculateRouteViaORS) : instruction déjà prête en français
  // (language: "fr" demandé à l'API) — pas de reconstruction à faire, à
  // l'inverse des steps OSRM (type/modifier) traités plus bas.
  if (step.instruction) return step.instruction;

  if (!step.maneuver) return "";

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
