const _escapeEl = document.createElement("span");

export function escapeHtml(str) {
  if (str == null) return "";
  _escapeEl.textContent = String(str);
  return _escapeEl.innerHTML.replace(/"/g, "&quot;");
}

/**
 * Normalisation centrale des IDs de point (Problème #2).
 *
 * Un même point peut exister avec des représentations différentes de son id
 * selon sa provenance : number (point_id serial Supabase, vieux cache
 * IndexedDB), string (UUID offline "arka_...", dataset.id DOM qui est
 * TOUJOURS une string). Toute comparaison croisée (marker -> store -> popup,
 * toggleVisit, sync, navigation) doit passer par ici pour garantir :
 *
 *   même point -> même id -> même type -> même résultat.
 *
 * @param {string|number|null|undefined} id
 * @returns {string} id normalisé (string trimmée, "" si absent)
 */
export function normalizePointId(id) {
  if (id == null) return "";
  return String(id).trim();
}

function normalizeForCompare(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents (marques diacritiques combinantes, U+0300-036F)
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1, // insertion
        prevRow[j] + 1, // suppression
        prevRow[j - 1] + cost // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

/**
 * Similarité normalisée entre deux chaînes (distance de Levenshtein),
 * insensible à la casse et aux accents. Sert à repérer des doublons
 * probables malgré une orthographe différente (ex: "Kouassi" / "Kwassi").
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 1 = identiques, 0 = complètement différentes (ou l'une
 * des deux vide)
 */
export function stringSimilarity(a, b) {
  const s1 = normalizeForCompare(a);
  const s2 = normalizeForCompare(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}
