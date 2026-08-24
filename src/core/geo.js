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
 * Point atteint en partant de (lat, lon), en suivant un cap fixe (grand
 * cercle), sur une distance donnée en mètres.
 *
 * Sert à dessiner le cercle de précision GPS autour de la position de
 * l'agent (voir modules/map/map.js) : un cercle réel en coordonnées
 * géographiques, qui se redimensionne correctement avec le zoom de la
 * carte — contrairement à un rayon en pixels fixe (circle-radius MapLibre)
 * qui ne représenterait pas la même distance réelle à chaque niveau de zoom.
 *
 * @param {number} lat latitude de départ
 * @param {number} lon longitude de départ
 * @param {number} bearingDeg cap en degrés depuis le nord vrai
 * @param {number} distanceMeters distance à parcourir, en mètres
 * @returns {{lat:number, lon:number}}
 */
export function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const delta = distanceMeters / R;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );

  return {
    lat: toDeg(phi2),
    lon: ((toDeg(lambda2) + 540) % 360) - 180
  };
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

/**
 * Distance perpendiculaire (en mètres) entre un point GPS et une polyligne.
 *
 * Sert à détecter un écart de tracé pendant la navigation (voir
 * modules/navigation/navigation.js) : compare la position courante à la
 * géométrie de l'itinéraire OSRM affiché.
 *
 * @param {number} lat latitude du point
 * @param {number} lon longitude du point
 * @param {Array<[number, number]>} polyline coordonnées [lon, lat]
 * (format GeoJSON/OSRM), au moins un point
 * @returns {number} distance en mètres, ou Infinity si les entrées
 * sont invalides/vides
 */
export function distanceToPolylineMeters(lat, lon, polyline) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Infinity;
  if (!Array.isArray(polyline) || polyline.length === 0) return Infinity;

  if (polyline.length === 1) {
    const [lonA, latA] = polyline[0];
    return haversineKm(lat, lon, latA, lonA) * 1000;
  }

  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad(lat));

  // Projection plane locale centrée sur le point interrogé — suffisamment
  // précise sur les échelles courtes (navigation piétonne/vélo/véhicule).
  const project = ([lonP, latP]) => ({
    x: R * toRad(lonP - lon) * cosLat,
    y: R * toRad(latP - lat)
  });

  let min = Infinity;

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
    if (d < min) min = d;
  }

  return min;
}

/**
 * Distance restante (en mètres) le long d'une polyligne, depuis le point
 * du tracé le plus proche de (lat, lon) jusqu'à la fin de la polyligne.
 *
 * À la différence d'une distance à vol d'oiseau vers la destination finale,
 * ceci suit le TRACÉ réel — indispensable en zone urbaine dense (blocs,
 * rues qui ne vont pas droit vers la destination) où le vol d'oiseau peut
 * sous-estimer très largement (voire ne pas décroître de façon monotone
 * pendant que l'agent marche) la distance qu'il reste réellement à
 * parcourir à pied.
 *
 * @param {number} lat latitude du point (position GPS actuelle)
 * @param {number} lon longitude du point
 * @param {Array<[number, number]>} polyline coordonnées [lon, lat]
 * (format GeoJSON/OSRM), au moins 2 points
 * @returns {number|null} distance en mètres, ou null si les entrées sont
 * invalides (polyligne trop courte, coordonnées non finies)
 */
export function remainingRouteDistanceMeters(lat, lon, polyline) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Array.isArray(polyline) || polyline.length < 2) return null;

  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad(lat));

  const project = ([lonP, latP]) => ({
    x: R * toRad(lonP - lon) * cosLat,
    y: R * toRad(latP - lat)
  });

  const segLengths = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const [lonA, latA] = polyline[i];
    const [lonB, latB] = polyline[i + 1];
    segLengths.push(haversineKm(latA, lonA, latB, lonB) * 1000);
  }
  const totalLength = segLengths.reduce((a, b) => a + b, 0);

  let bestDist = Infinity;
  let bestRemaining = totalLength;
  let lengthBeforeSeg = 0;

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
      const distanceIntoSeg = t * segLengths[i];
      bestRemaining = Math.max(0, totalLength - lengthBeforeSeg - distanceIntoSeg);
    }

    lengthBeforeSeg += segLengths[i];
  }

  return bestRemaining;
}

/**
 * Différence angulaire absolue entre deux caps, dans [0, 180] — la plus
 * courte des deux façons de tourner de l'un vers l'autre (ex: 350° et 10°
 * ne sont écartés que de 20°, pas de 340°). Sert à mesurer à quel point un
 * point candidat oblige à dévier de la direction de progression établie
 * (voir tourPlanner.js, routing.js: findNearestByRoad) — 0° = droit devant,
 * 180° = demi-tour complet.
 *
 * @param {number} a cap en degrés
 * @param {number} b cap en degrés
 * @returns {number} écart en degrés dans [0, 180], ou 0 si une entrée n'est
 * pas un nombre fini (pas de pénalité applicable sans cap connu).
 */
export function angleDiffDeg(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
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
