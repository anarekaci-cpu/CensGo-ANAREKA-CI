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

/**
 * Cap (bearing) en degrés [0, 360) entre deux points GPS, mesuré depuis
 * le nord vrai dans le sens horaire.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} cap en degrés, dans [0, 360)
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const CARDINAL_LABELS = [
  "Nord",
  "Nord-Est",
  "Est",
  "Sud-Est",
  "Sud",
  "Sud-Ouest",
  "Ouest",
  "Nord-Ouest"
];

/**
 * Convertit un cap en degrés en libellé cardinal français (8 directions).
 *
 * @param {number} deg cap en degrés (peut dépasser [0, 360))
 * @returns {string} libellé cardinal, ou "" si deg n'est pas un nombre fini
 */
export function cardinalLabel(deg) {
  if (!Number.isFinite(deg)) return "";
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return CARDINAL_LABELS[index];
}
