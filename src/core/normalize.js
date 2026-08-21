/**
 * Normalisation centrale des points de recensement.
 *
 * Toute donnée entrant dans l'application (Supabase, IndexedDB, formulaire,
 * dictée IA) passe par normalizePoint() afin de garantir un format unique :
 * la carte, le store, les popups, les filtres et les statistiques ne doivent
 * JAMAIS avoir à deviner si id est un nombre ou une string, si visited est
 * "oui" ou true, ou si lat/lon sont exploitables.
 */

export const DEFAULT_STATUS = "NON DEFINI";

/**
 * Valide un couple de coordonnées.
 * @returns {boolean} true si lat/lon sont numériques et dans les bornes géographiques
 */
export function isValidLatLng(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );
}

function toStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

function toBool(v) {
  return v === true || v === "true" || v === "oui" || v === 1 || v === "1";
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Transforme une ligne brute (Supabase / IndexedDB / formulaire) en point
 * normalisé. Ne lève jamais d'exception : un enregistrement corrompu produit
 * un point dégradé mais affichable, avec les coordonnées mises à null si
 * invalides (un point sans coordonnées fiables ne doit jamais atterrir au
 * mauvais endroit de la carte).
 *
 * @param {object} raw - ligne brute, champs snake_case OU camelCase acceptés
 * @returns {object} point normalisé
 */
export function normalizePoint(raw) {
  if (!raw || typeof raw !== "object") {
    return _emptyPoint();
  }

  const lat = toNum(raw.lat ?? raw.latitude);
  const lon = toNum(raw.lon ?? raw.lng ?? raw.longitude);
  const coordsOk = isValidLatLng(lat, lon);

  const point = {
    // id : TOUJOURS string — les UUID générés offline ("arka_...") comme les
    // point_id Supabase sont comparés via === partout dans l'app ; un mélange
    // number/string casserait silencieusement marker -> store -> popup.
    id: toStr(raw.id ?? raw.point_id),
    block: toNum(raw.block) ?? 0,
    order: toNum(raw.order),
    name: toStr(raw.name),
    tel: toStr(raw.tel),
    etablissement: toStr(raw.etablissement),
    activityType: toStr(raw.activityType ?? raw.activity_type),
    quartier: toStr(raw.quartier),
    address: toStr(raw.address),
    produits: toStr(raw.produits),
    sexe: toStr(raw.sexe) || "Homme",
    status: toStr(raw.status) || DEFAULT_STATUS,
    visited: toBool(raw.visited),
    lat: coordsOk ? lat : null,
    lon: coordsOk ? lon : null,
    updatedAt: toStr(raw.updatedAt ?? raw.updated_at) || null,
    createdAt: toStr(raw.createdAt ?? raw.created_at) || null
  };

  if (!coordsOk && (lat != null || lon != null)) {
    // Coordonnées présentes mais invalides : on le signale plutôt que de
    // laisser un point silencieusement mal placé (ex: parseFloat("abc")
    // qui tombait auparavant sur le centre par défaut).
    point.invalidCoords = true;
  }

  return point;
}

function _emptyPoint() {
  return {
    id: "",
    block: 0,
    order: null,
    name: "",
    tel: "",
    etablissement: "",
    activityType: "",
    quartier: "",
    address: "",
    produits: "",
    sexe: "Homme",
    status: DEFAULT_STATUS,
    visited: false,
    lat: null,
    lon: null,
    updatedAt: null,
    createdAt: null
  };
}

/**
 * Normalise un lot de points en éliminant les doublons d'id (le dernier gagne)
 * et les entrées sans identifiant. Source de vérité unique pour le store :
 * garantit qu'aucun point ne peut être compté ou affiché deux fois, même si
 * IndexedDB contient encore des résidus d'une course critique antérieure.
 *
 * @param {object[]} rows - lignes brutes
 * @returns {object[]} points normalisés, dédupliqués, ordre stable
 */
export function normalizePoints(rows) {
  if (!Array.isArray(rows)) return [];
  const byId = new Map();
  for (const row of rows) {
    const p = normalizePoint(row);
    if (!p.id) continue;
    byId.set(p.id, p);
  }
  return [...byId.values()];
}
