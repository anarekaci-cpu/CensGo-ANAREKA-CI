/**
 * Géométrie pure du radar de la boussole terrain.
 *
 * Sépare le calcul de position (testable sans DOM) du rendu — voir
 * modules/compass/compassView.js pour l'utilisation.
 */

/**
 * Position polaire d'une cible (point ou marque cardinale) par rapport au
 * cap actuel du téléphone.
 *
 * @param {number} bearing - cap réel vers la cible, en degrés [0, 360)
 * @param {number} heading - cap actuel du téléphone, en degrés [0, 360)
 * @param {number} distanceKm - distance à la cible en km
 * @param {number} maxKm - distance de référence correspondant au bord du cadran
 * @returns {{angleDeg: number, radiusFraction: number}} angle relatif (0 = haut de l'écran,
 *   sens horaire) et fraction du rayon [0, 1] — 1 = bord du cadran
 */
export function computeBlipPosition(bearing, heading, distanceKm, maxKm) {
  const relativeAngle = (((bearing - heading) % 360) + 360) % 360;
  const safeMax = maxKm > 0 ? maxKm : 1;
  const radiusFraction = Math.min(Math.max(distanceKm / safeMax, 0), 1);
  return { angleDeg: relativeAngle, radiusFraction };
}

/**
 * Convertit une position polaire en coordonnées absolues exprimées en
 * pourcentage (left/top) à l'intérieur d'un cadran carré/circulaire.
 * 0° = haut (Nord relatif), sens horaire.
 *
 * @param {{angleDeg: number, radiusFraction: number}} position
 * @param {{minRadiusPct?: number, maxRadiusPct?: number}} [options]
 * @returns {{leftPct: number, topPct: number}}
 */
export function blipToPercentPosition({ angleDeg, radiusFraction }, options = {}) {
  const { minRadiusPct = 10, maxRadiusPct = 45 } = options;
  const radiusPct = minRadiusPct + radiusFraction * (maxRadiusPct - minRadiusPct);
  const rad = (angleDeg * Math.PI) / 180;
  const leftPct = 50 + radiusPct * Math.sin(rad);
  const topPct = 50 - radiusPct * Math.cos(rad);
  return { leftPct, topPct };
}
