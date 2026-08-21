/**
 * Planification de tournée — logique PURE (aucun import DOM/store/map).
 *
 * Algorithme : plus proche voisin glouton. Le coût naïf est O(N²) — sur
 * 10 000 points non visités cela représentait ~100M de calculs haversine
 * au clic sur "Tournée optimisée", soit plusieurs secondes de blocage du
 * thread principal sur un téléphone d'entrée de gamme.
 *
 * Stratégie : on plafonne la tournée aux MAX_TOUR_STOPS points les plus
 * proches du point de départ (pré-sélection O(N)), puis on fait le glouton
 * sur ce sous-ensemble (150² = 22 500 opérations, imperceptible). Une
 * tournée journalière réelle dépasse rarement quelques dizaines d'arrêts ;
 * l'agent relance simplement la tournée une fois celle-ci terminée.
 */

export const MAX_TOUR_STOPS = 150;

/**
 * @param {object[]} points - points normalisés (lat/lon numériques)
 * @param {{lat:number, lng:number}} startPos - position de départ
 * @param {number} [maxStops=MAX_TOUR_STOPS]
 * @returns {object[]} tournée ordonnée, chaque point porte distanceFromPrev (km)
 */
export function generateOptimizedTour(points, startPos, maxStops = MAX_TOUR_STOPS) {
  if (!Array.isArray(points) || !startPos) return [];

  const usable = points.filter(p =>
    !p.visited &&
    Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (usable.length === 0) return [];

  // Pré-sélection O(N) des K plus proches du départ (tri partiel par distance).
  let candidates = usable;
  if (usable.length > maxStops) {
    candidates = usable
      .map(p => ({ p, d0: _haversineKm(startPos.lat, startPos.lng, p.lat, p.lon) }))
      .sort((a, b) => a.d0 - b.d0)
      .slice(0, maxStops)
      .map(e => e.p);
  }

  const tour = [];
  let current = { lat: startPos.lat, lng: startPos.lng };
  const remaining = [...candidates];

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = _haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lon);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }

    const next = remaining.splice(nearestIdx, 1)[0];
    tour.push({ ...next, distanceFromPrev: minDist });
    current = { lat: next.lat, lng: next.lon };
  }

  return tour;
}

function _haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
