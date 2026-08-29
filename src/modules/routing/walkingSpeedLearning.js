// Sous ce cumul (ou avec un fix isolé), l'échantillon est jugé trop pauvre
// pour remplacer la constante par défaut (AVERAGE_SPEEDS_MPS.foot, routing.js).
const MIN_SESSION_DISTANCE_KM = 0.1;
const MIN_SESSION_DURATION_S = 60;
// En dehors de cette plage, la session mêle très probablement des arrêts
// prolongés (< 0.3 m/s, ~1 km/h) ou un déplacement assisté vélo/véhicule
// (> 2.5 m/s, ~9 km/h) — pas un rythme de marche exploitable.
const MIN_PLAUSIBLE_SPEED_MPS = 0.3;
const MAX_PLAUSIBLE_SPEED_MPS = 2.5;
const MIN_TOTAL_DISTANCE_KM = 2;
const MIN_SESSION_COUNT = 3;

/**
 * Vitesse de marche moyenne dérivée des tournées réellement effectuées par
 * l'agent (tour_sessions), plutôt que la constante générique ~5 km/h
 * (AVERAGE_SPEEDS_MPS.foot, voir routing.js) qui ne reflète ni le terrain
 * réel (pentes, pistes non bitumées) ni le rythme propre à chaque agent.
 *
 * Moyenne PONDÉRÉE par la distance (somme distances / somme durées), pas
 * une moyenne des vitesses par session : une session de 200m ne doit pas
 * peser autant qu'une tournée de 5km dans le résultat.
 *
 * @param {Array<{distanceKm:number, startedAt:string, endedAt:string}>} sessions
 * @returns {number|null} vitesse en m/s, ou null si l'échantillon est
 * insuffisant/trop bruité pour être fiable — l'appelant doit alors retomber
 * sur la constante par défaut.
 */
export function computeLearnedWalkingSpeedMps(sessions) {
  if (!Array.isArray(sessions)) return null;

  let totalDistanceM = 0;
  let totalDurationS = 0;
  let validCount = 0;

  for (const session of sessions) {
    const distanceKm = Number(session?.distanceKm);
    if (!Number.isFinite(distanceKm) || distanceKm < MIN_SESSION_DISTANCE_KM) continue;

    const startedAt = Date.parse(session?.startedAt);
    const endedAt = Date.parse(session?.endedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) continue;

    const durationS = (endedAt - startedAt) / 1000;
    if (!Number.isFinite(durationS) || durationS < MIN_SESSION_DURATION_S) continue;

    const speedMps = (distanceKm * 1000) / durationS;
    if (speedMps < MIN_PLAUSIBLE_SPEED_MPS || speedMps > MAX_PLAUSIBLE_SPEED_MPS) continue;

    totalDistanceM += distanceKm * 1000;
    totalDurationS += durationS;
    validCount++;
  }

  if (validCount < MIN_SESSION_COUNT || totalDistanceM < MIN_TOTAL_DISTANCE_KM * 1000 || totalDurationS <= 0) {
    return null;
  }

  return totalDistanceM / totalDurationS;
}
