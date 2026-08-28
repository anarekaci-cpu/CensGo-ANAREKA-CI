import { normalizePointId, stringSimilarity } from "../../core/utils.js";

const EARTH_RADIUS_M = 6371000;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeTelDigits(tel) {
  return String(tel || "").replace(/\D/g, "");
}

/**
 * Détection de doublons "strict" (même position) + "flou" (nom/téléphone
 * proche dans un rayon plus large), en un seul passage sur `points`.
 *
 * Remplace deux appels séquentiels findNearbyPoints() (donc deux
 * requêtes IndexedDB async) par un scan unique du tableau déjà en mémoire
 * dans le store — mêmes règles de détection, même exclusion des points
 * déjà comptés en "strict" de la liste "fuzzy" (voir censusFormModal.js).
 */
export function findProximityMatches(points, {
  lat,
  lon,
  name = "",
  tel = "",
  excludeId = null,
  strictRadiusM = 25,
  fuzzyRadiusM = 150,
  fuzzyNameThreshold = 0.78
} = {}) {
  const excludeKey = normalizePointId(excludeId);
  const telDigits = normalizeTelDigits(tel);
  const trimmedName = (name || "").trim();
  const hasFuzzyCriteria = trimmedName.length > 0 || telDigits.length > 0;

  const strict = [];
  const fuzzy = [];

  for (const p of points || []) {
    if (p.lat == null || p.lon == null) continue;
    if (normalizePointId(p.id) === excludeKey) continue;

    const distM = distanceMeters(lat, lon, p.lat, p.lon);
    if (distM <= strictRadiusM) {
      strict.push(p);
      continue;
    }
    if (!hasFuzzyCriteria || distM > fuzzyRadiusM) continue;

    const telMatch = telDigits.length >= 8 && normalizeTelDigits(p.tel) === telDigits;
    const nameMatch = trimmedName.length >= 3 && stringSimilarity(trimmedName, p.name) >= fuzzyNameThreshold;
    if (telMatch || nameMatch) fuzzy.push(p);
  }

  return { strict, fuzzy };
}
