/**
 * Formatage d'une distance en km pour l'affichage terrain.
 * < 1 km -> mètres arrondis ; sinon kilomètres à 1 décimale.
 */
export function formatDist(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}
