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
