/**
 * Planificateur de tournée ROUTE-AWARE (corridor sweep) — remplace
 * l'ancienne approche "score = distance + pénalité d'angle" de
 * tourPlanner.js pour la génération de tournée multi-arrêts.
 *
 * CAUSE RACINE DU BUG PERSISTANT (rapport terrain, capture d'écran) : le
 * glouton bearing-based de tourPlanner.js ne connaît JAMAIS le réseau
 * routier réel — il approxime "je suis sur cet axe" par un simple écart
 * angulaire vol-d'oiseau entre le cap déjà établi et le cap du candidat.
 * Dans une trame urbaine dense (rues qui tournent, blocs, lagune/pont),
 * cette approximation s'effondre : un point peut avoir un cap très
 * différent du cap direct vers la destination tout en étant PHYSIQUEMENT
 * sur la route empruntée (la route tourne, le point non). Empiler une
 * troisième correction de score n'aurait pas changé cela — le problème
 * n'est pas la formule de score, c'est l'ABSENCE de géométrie de route
 * réelle dans la décision. Ce module corrige cela à la racine : il
 * n'estime plus une direction, il PROJETTE chaque point candidat sur la
 * géométrie réelle renvoyée par OSRM et mesure sa position le long de
 * cette route (progression), exactement comme demandé.
 *
 * ARCHITECTURE ("PROGRESSIVE ROUTE SWEEP", pas un TSP classique) :
 *
 *   1. anchor = parmi les K points non-visités les plus proches à vol
 *      d'oiseau (présélection bon marché), celui dont la distance ROUTÉE
 *      réelle (OSRM /table, un seul appel groupé) est la plus courte —
 *      PAS simplement le plus proche à vol d'oiseau. Sans cela, le cas
 *      "lagune/pont" (un point de l'autre côté de l'eau paraît proche à
 *      vol d'oiseau mais exige un détour) resurgirait ICI même si le
 *      balayage de corridor (étapes 3-6) fonctionne parfaitement — c'est
 *      exactement le même bug que celui déjà corrigé pour le bouton
 *      "plus proche" (routing.js:findNearestByRoad), appliqué maintenant
 *      au choix d'ancre de CHAQUE lot de la tournée.
 *   2. route(current, anchor) — UN appel OSRM réel (geometry complète).
 *   3. Tous les AUTRES points non-visités restants sont projetés sur
 *      cette géométrie : distance perpendiculaire à la route + position
 *      le long de la route (progression, en mètres depuis `current`).
 *   4. Un point est un "ON_ROUTE_CANDIDATE" si sa distance à la route est
 *      sous le corridor configuré ET que sa progression est en avant de
 *      la position courante (jamais derrière).
 *   5. Vérification d'accessibilité réelle (pas seulement géométrique) :
 *      UN appel /table groupé compare la distance ROUTÉE réelle de
 *      `current` à chaque candidat retenu à sa progression estimée — un
 *      candidat proche de la polyligne mais sur une branche différente
 *      (clôture, obstacle, autre rue) a une distance routée bien plus
 *      grande que sa progression et est écarté.
 *   6. Les candidats retenus sont insérés dans la séquence, ORDONNÉS par
 *      progression croissante, puis l'ancre elle-même.
 *   7. La position courante avance jusqu'à l'ancre et le cycle recommence
 *      sur les points restants — RECALCUL après chaque "lot" balayé,
 *      jamais un plan figé calculé une seule fois à l'avance.
 *
 * Coût réseau : jusqu'à 3 appels OSRM par "lot" balayé (choix d'ancre,
 * géométrie de route, vérification d'accessibilité) — jamais par point.
 * Dans une zone de recensement dense (le cas réel signalé), un seul lot
 * balaie couramment des dizaines de points d'une même route. Plafonné par
 * MAX_ROUTE_LEGS ; au-delà (ou hors-ligne, ou échec réseau), le reste du
 * bassin de points est confié au glouton bearing-based de tourPlanner.js
 * (déjà correct hors-ligne, voir son propre commentaire d'en-tête) —
 * dégradation explicite et déterministe, jamais un plantage silencieux.
 *
 * Ce n'est délibérément PAS un TSP (pas de minimisation globale de
 * distance totale avec retour arrière autorisé) : le recensement est une
 * progression de terrain, pas un problème d'optimisation abstrait — voir
 * point 13 du cahier des charges.
 */

import { haversineKm } from "./geo.js";
import { generateOptimizedTour, preselectNearestStops, MAX_TOUR_STOPS } from "./tourPlanner.js";
import { log, isVerbose } from "./debug.js";

// Largeur du corridor de capture autour de la route, par mode de
// transport (mètres). Volontairement modeste — voir point 9 du cahier
// des charges ("ne choisis pas arbitrairement une valeur énorme") : un
// piéton dévie rarement de plus de ~35m de son trottoir pour un point de
// recensement, un véhicule peut légitimement viser un point un peu plus
// en retrait (parking, allée).
const CORRIDOR_METERS_BY_MODE = {
  foot: 35,
  bike: 50,
  car: 70
};

// Nombre maximum de "lots" (legs) route-aware avant repli sur le glouton
// hors-ligne pour le reste — protège un mobile en terrain de dizaines
// d'allers-retours réseau séquentiels si les points sont très dispersés
// (aucun corridor commun, un lot = un seul point balayé à chaque fois).
export const MAX_ROUTE_LEGS = 40;

// Un point à moins de MIN_PROGRESS_M de la position courante est
// considéré "déjà là" plutôt que "devant" — évite de re-sélectionner un
// point quasi confondu avec le départ comme s'il fallait progresser vers
// lui.
const MIN_PROGRESS_M = 5;

// Tolérance de détour pour la vérification d'accessibilité réelle
// (étape 5 ci-dessus) : la distance ROUTÉE réelle vers un candidat ne
// doit pas dépasser sa progression géométrique estimée de plus de ce
// facteur + cette marge fixe — au-delà, ce n'est plus "sur le chemin",
// c'est un détour déguisé (branche différente, obstacle).
const DETOUR_TOLERANCE_FACTOR = 1.5;
const DETOUR_TOLERANCE_BASE_M = 150;

export function corridorMetersForMode(mode) {
  return CORRIDOR_METERS_BY_MODE[mode] || CORRIDOR_METERS_BY_MODE.foot;
}

/**
 * Pré-calcule les longueurs de segments et la longueur totale d'une
 * géométrie de route OSRM — évite de refaire cette somme pour chaque
 * point projeté dessus.
 *
 * @param {Array<[number, number]>} polyline coordonnées [lon, lat]
 * @returns {{polyline: Array<[number,number]>, segLengthsM: number[], totalLengthM: number}}
 */
export function buildRouteContext(polyline) {
  const segLengthsM = [];
  let totalLengthM = 0;

  if (Array.isArray(polyline)) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const [lonA, latA] = polyline[i];
      const [lonB, latB] = polyline[i + 1];
      const len = haversineKm(latA, lonA, latB, lonB) * 1000;
      segLengthsM.push(len);
      totalLengthM += len;
    }
  }

  return { polyline: polyline || [], segLengthsM, totalLengthM };
}

/**
 * Projette un point sur la géométrie de route (routeContext) : distance
 * perpendiculaire minimale à la route, et position le long de la route
 * (progression, en mètres depuis le tout début de la géométrie) au point
 * de projection le plus proche.
 *
 * Même technique de projection plane locale que
 * core/geo.js:distanceToPolylineMeters/remainingRouteDistanceMeters
 * (précision suffisante à l'échelle piéton/vélo/véhicule urbain).
 *
 * @param {{lat:number, lon:number}} point
 * @param {ReturnType<typeof buildRouteContext>} routeContext
 * @returns {{distanceToRouteM:number, progressM:number}}
 */
export function projectPointOnRoute(point, routeContext) {
  const { polyline, segLengthsM } = routeContext;

  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) || polyline.length < 2) {
    return { distanceToRouteM: Infinity, progressM: 0 };
  }

  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad(point.lat));

  const project = ([lonP, latP]) => ({
    x: R * toRad(lonP - point.lon) * cosLat,
    y: R * toRad(latP - point.lat)
  });

  let bestDist = Infinity;
  let bestProgress = 0;
  let lengthBefore = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = project(polyline[i]);
    const b = project(polyline[i + 1]);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;

    let t = lengthSq === 0 ? 0 : (-a.x * dx - a.y * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const closestX = a.x + t * dx;
    const closestY = a.y + t * dy;
    const d = Math.sqrt(closestX * closestX + closestY * closestY);

    if (d < bestDist) {
      bestDist = d;
      bestProgress = lengthBefore + t * segLengthsM[i];
    }

    lengthBefore += segLengthsM[i];
  }

  return { distanceToRouteM: bestDist, progressM: bestProgress };
}

/**
 * Classifie un candidat projeté : ON_ROUTE (dans le corridor, devant la
 * position courante), BEHIND (déjà dépassé) ou OFF_CORRIDOR (trop loin
 * de la route).
 *
 * @param {{distanceToRouteM:number, progressM:number}} projection
 * @param {number} corridorMeters
 * @returns {"ON_ROUTE"|"BEHIND"|"OFF_CORRIDOR"}
 */
export function classifyRouteCandidate(projection, corridorMeters) {
  if (!Number.isFinite(projection?.distanceToRouteM) || !Number.isFinite(projection?.progressM)) {
    return "OFF_CORRIDOR";
  }
  if (projection.progressM <= MIN_PROGRESS_M) return "BEHIND";
  if (projection.distanceToRouteM > corridorMeters) return "OFF_CORRIDOR";
  return "ON_ROUTE";
}

/**
 * Trie une liste de candidats classifiés ON_ROUTE par progression
 * croissante le long de la route — l'ordre de rencontre naturel d'un
 * agent qui suit cette route, pas un tri par distance individuelle.
 *
 * @param {Array<{progressM:number}>} candidates
 * @returns {Array}
 */
export function orderRouteCandidates(candidates) {
  return [...candidates].sort((a, b) => a.progressM - b.progressM);
}

// Taille de la présélection à vol d'oiseau soumise à la vérification
// routière réelle pour le choix d'ancre — petit et borné : un seul appel
// /table groupé quel que soit K, mais K doit rester modeste pour que la
// présélection ait une chance de contenir le vrai plus-proche par la
// route (au-delà, un point objectivement bien plus proche à vol d'oiseau
// prend le pas de toute façon, cf. repli plus bas).
const ANCHOR_SHORTLIST_SIZE = 8;

/**
 * Choisit le point d'ancrage du prochain lot : parmi les
 * ANCHOR_SHORTLIST_SIZE points les plus proches à vol d'oiseau, celui
 * dont la distance ROUTÉE réelle est la plus courte (voir étape 1 du
 * commentaire d'en-tête). Repli sur le plus proche à vol d'oiseau si
 * `fetchRoadDistances` est absent ou échoue.
 *
 * @param {{lat:number, lon:number}} current
 * @param {object[]} pool
 * @param {Function|null} fetchRoadDistances
 * @returns {Promise<object|null>}
 */
async function pickAnchor(current, pool, fetchRoadDistances) {
  if (pool.length === 0) return null;

  const shortlist = pool
    .map(p => ({ p, d0: haversineKm(current.lat, current.lon, p.lat, p.lon) }))
    .sort((a, b) => a.d0 - b.d0)
    .slice(0, ANCHOR_SHORTLIST_SIZE)
    .map(e => e.p);

  if (shortlist.length <= 1 || !fetchRoadDistances) return shortlist[0];

  try {
    const distances = await fetchRoadDistances(current.lat, current.lon, shortlist);
    if (Array.isArray(distances)) {
      let bestIdx = -1;
      let bestDistance = Infinity;
      distances.forEach((d, i) => {
        if (typeof d === "number" && d < bestDistance) {
          bestDistance = d;
          bestIdx = i;
        }
      });
      if (bestIdx !== -1) return shortlist[bestIdx];
    }
  } catch (err) {
    log.warn("TOUR", "pickAnchor: vérification routière échouée, repli sur le vol d'oiseau:", err?.message || err);
  }

  return shortlist[0];
}

function removeById(pool, id) {
  const idx = pool.findIndex(p => p.id === id);
  if (idx !== -1) pool.splice(idx, 1);
}

/**
 * Construit une tournée route-aware : voir le commentaire d'en-tête du
 * module pour l'architecture complète.
 *
 * @param {object[]} points - points normalisés (lat/lon numériques)
 * @param {{lat:number, lng:number}} startPos - position de départ
 * @param {object} [options]
 * @param {"foot"|"bike"|"car"} [options.mode="foot"]
 * @param {number} [options.maxStops=MAX_TOUR_STOPS]
 * @param {number} [options.corridorMeters] - remplace le corridor par défaut du mode
 * @param {number} [options.maxLegs=MAX_ROUTE_LEGS]
 * @param {(fromLat:number, fromLng:number, toLat:number, toLng:number, mode:string) => Promise<{geometry:{coordinates:Array<[number,number]>}}>} [options.fetchRoute]
 *   injecté plutôt qu'importé directement : garde ce module testable sans
 *   réseau réel et sans dépendance circulaire vers modules/routing/routing.js.
 * @param {(fromLat:number, fromLng:number, candidates:Array<{lat:number,lon:number}>) => Promise<Array<number|null>|null>} [options.fetchRoadDistances]
 * @param {boolean} [options.debug=false] - si vrai, le résultat inclut `debugLog`
 *   (voir point 19 du cahier des charges — activé en pratique via
 *   localStorage.DEBUG, comme le reste du logging terrain de l'app).
 * @returns {Promise<{sequence: object[], debugLog: object[]}>}
 */
export async function planRouteAwareTour(points, startPos, options = {}) {
  const {
    mode = "foot",
    maxStops = MAX_TOUR_STOPS,
    corridorMeters = corridorMetersForMode(mode),
    maxLegs = MAX_ROUTE_LEGS,
    fetchRoute = null,
    fetchRoadDistances = null,
    debug = false
  } = options;

  if (!Array.isArray(points) || !startPos) return { sequence: [], debugLog: [] };

  const pool = preselectNearestStops(points, startPos, maxStops);
  if (pool.length === 0) return { sequence: [], debugLog: [] };

  const sequence = [];
  const debugLog = [];
  let current = { lat: startPos.lat, lon: startPos.lng };
  let legs = 0;
  let networkAvailable = Boolean(fetchRoute);

  const appendFallback = (remainingPool, reason) => {
    const fallback = generateOptimizedTour(
      remainingPool,
      { lat: current.lat, lng: current.lon },
      remainingPool.length
    );
    sequence.push(...fallback);
    if (debug) debugLog.push({ leg: "fallback-heuristic", reason, count: fallback.length });
  };

  while (pool.length > 0) {
    if (!networkAvailable || legs >= maxLegs) {
      appendFallback(pool, !networkAvailable ? "network-unavailable" : "max-legs-reached");
      break;
    }

    const anchor = await pickAnchor(current, pool, fetchRoadDistances);
    if (!anchor) break;
    legs++;

    let route = null;
    try {
      route = await fetchRoute(current.lat, current.lon, anchor.lat, anchor.lon, mode);
    } catch (err) {
      log.warn("TOUR", "planRouteAwareTour: fetchRoute a échoué, repli hors-ligne:", err?.message || err);
    }

    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      // Ce point précis est inatteignable (ou le réseau vient de tomber) :
      // on le prend directement à vol d'oiseau et on bascule en mode
      // hors-ligne pour le reste, plutôt que de re-tenter à chaque
      // itération (évite de marteler un serveur en panne).
      sequence.push({ ...anchor, distanceFromPrev: haversineKm(current.lat, current.lon, anchor.lat, anchor.lon) });
      removeById(pool, anchor.id);
      current = { lat: anchor.lat, lon: anchor.lon };
      networkAvailable = false;
      if (debug) debugLog.push({ leg: legs, anchorId: anchor.id, routeFailed: true });
      continue;
    }

    const routeContext = buildRouteContext(coords);
    const legCandidates = pool.filter(p => p.id !== anchor.id);
    const classified = legCandidates.map(p => {
      const projection = projectPointOnRoute(p, routeContext);
      return {
        point: p,
        ...projection,
        classification: classifyRouteCandidate(projection, corridorMeters)
      };
    });

    let onRoute = classified.filter(c => c.classification === "ON_ROUTE");

    // Vérification d'accessibilité réelle (point 7/8 du cahier des
    // charges) : proximité géométrique à la polyligne != accessible par
    // la route. Un unique appel /table groupé pour TOUS les candidats de
    // ce lot compare leur distance routée réelle depuis `current` à leur
    // progression géométrique estimée.
    if (onRoute.length > 0 && fetchRoadDistances) {
      try {
        const distances = await fetchRoadDistances(current.lat, current.lon, onRoute.map(c => c.point));
        if (Array.isArray(distances)) {
          onRoute = onRoute.filter((c, i) => {
            const routedM = distances[i];
            if (typeof routedM !== "number") {
              if (debug) c.classification = "UNREACHABLE";
              return false;
            }
            const accessible = routedM <= c.progressM * DETOUR_TOLERANCE_FACTOR + DETOUR_TOLERANCE_BASE_M;
            if (debug && !accessible) c.classification = "OFF_CORRIDOR_DETOUR";
            return accessible;
          });
        }
      } catch (err) {
        log.warn("TOUR", "planRouteAwareTour: vérification d'accessibilité échouée (ignorée):", err?.message || err);
      }
    }

    onRoute = orderRouteCandidates(onRoute);

    let prevProgress = 0;
    for (const c of onRoute) {
      sequence.push({ ...c.point, distanceFromPrev: Math.max(0, c.progressM - prevProgress) / 1000 });
      removeById(pool, c.point.id);
      prevProgress = c.progressM;
    }
    sequence.push({ ...anchor, distanceFromPrev: Math.max(0, routeContext.totalLengthM - prevProgress) / 1000 });
    removeById(pool, anchor.id);
    current = { lat: anchor.lat, lon: anchor.lon };

    if (debug || isVerbose()) {
      const entry = {
        leg: legs,
        routeLengthM: Math.round(routeContext.totalLengthM),
        anchorId: anchor.id,
        candidates: classified.map(c => ({
          id: c.point.id,
          distanceToRouteM: Math.round(c.distanceToRouteM),
          progressM: Math.round(c.progressM),
          classification: c.classification
        })),
        selectedSequence: onRoute.map(c => c.point.id).concat(anchor.id)
      };
      if (debug) debugLog.push(entry);
      if (isVerbose()) {
        log.debug("TOUR", `ROUTE DEBUG — lot #${legs}, route ${(entry.routeLengthM / 1000).toFixed(2)} km`);
        for (const c of entry.candidates) {
          log.debug(
            "TOUR",
            `  Candidat ${c.id} — dist. route: ${c.distanceToRouteM}m, progression: +${c.progressM}m, classe: ${c.classification}`
          );
        }
        log.debug("TOUR", "  SÉQUENCE SÉLECTIONNÉE:", entry.selectedSequence.join(" -> "));
      }
    }
  }

  return { sequence, debugLog };
}
