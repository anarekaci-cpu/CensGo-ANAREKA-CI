/**
 * Filtres de points — logique PURE, sans DOM ni store.
 *
 * Extraite d'appView.js pour être testable unitairement et réutilisable
 * partout où l'on doit savoir si un point passe les filtres actifs
 * (rendu des marqueurs, futurs exports, statistiques filtrées...).
 */

export const DEFAULT_FILTERS = Object.freeze({
  block: "all",
  status: "all",
  visited: "all",
  search: ""
});

// Recherche insensible aux accents : un agent qui tape "kiosque attieke"
// (sans accents, clavier/habitude courante) ne trouvait auparavant rien
// pour un point enregistré "Kiosque Attiéké" — comparaison stricte sur la
// chaîne accentuée. La normalisation Unicode NFD sépare chaque lettre
// accentuée de son diacritique (é -> e + ́), qu'on retire ensuite.
function foldAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * @param {object} point - point normalisé du store
 * @param {object} filters - { block, status, visited, search }
 * @returns {boolean} true si le point doit être affiché
 */
export function passesFilters(point, filters) {
  if (!point) return false;
  const f = filters || DEFAULT_FILTERS;

  if (f.block && f.block !== "all" && String(point.block) !== String(f.block)) return false;
  if (f.status && f.status !== "all" && point.status !== f.status) return false;
  if (f.visited === "yes" && !point.visited) return false;
  if (f.visited === "no" && point.visited) return false;

  if (f.search) {
    const q = foldAccents(String(f.search).toLowerCase());
    const hay = foldAccents(`${point.name || ""} ${point.quartier || ""} ${point.address || ""} ${point.tel || ""} ${point.produits || ""} ${point.id || ""} ${point.order ?? ""}`.toLowerCase());
    if (!hay.includes(q)) return false;
  }
  return true;
}

/**
 * Filtre une liste complète. Retourne la même instance si aucun filtre actif
 * (évite une copie inutile de 10 000 points à chaque rendu).
 */
export function filterPoints(points, filters) {
  const list = Array.isArray(points) ? points : [];
  const f = filters || DEFAULT_FILTERS;
  const inactive =
    (!f.block || f.block === "all") &&
    (!f.status || f.status === "all") &&
    (!f.visited || f.visited === "all") &&
    !f.search;
  if (inactive) return list;
  return list.filter(p => passesFilters(p, f));
}
