/**
 * Distance en km entre deux points GPS (Haversine)
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Conversion centrale lat/lon -> coordonnées GeoJSON/MapLibre (Problème #6).
 *
 * MapLibre et le format GeoJSON attendent STRICTEMENT [longitude, latitude],
 * alors que l'API Geolocation du navigateur et la base fournissent lat d'abord.
 * Toute construction de coordonnées pour la carte DOIT passer par ici afin
 * d'éliminer définitivement les inversions [lat, lon] <-> [lon, lat].
 *
 * @param {number|null} lat
 * @param {number|null} lon
 * @returns {[number, number]|null} [longitude, latitude] ou null si invalide
 */
export function toGeoJSONCoordinates(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}
