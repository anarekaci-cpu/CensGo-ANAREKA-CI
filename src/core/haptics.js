/**
 * Retour haptique (navigator.vibrate) — court, ciblé, jamais bloquant.
 *
 * Centralise les motifs pour rester COHÉRENT dans toute l'app : une
 * "réussite" doit vibrer pareil qu'elle vienne de la validation d'une fiche
 * de recensement, de l'arrivée en navigation ou d'un toast de succès. Sur le
 * terrain, l'agent a souvent le téléphone en main sans le regarder (il
 * marche, il parle au commerçant) : une vibration franche confirme
 * l'action mieux qu'un toast qu'il ne verra pas.
 *
 * Silencieux et sûr si l'API est absente (desktop, iOS Safari) ou refusée.
 */

export const HAPTIC_PATTERNS = Object.freeze({
  // Action réussie : fiche enregistrée, point marqué visité, arrivée simple.
  success: 40,
  // Avertissement non bloquant (toast warning, doublon probable...).
  warning: 100,
  // Erreur (échec de synchronisation, erreur de formulaire).
  error: 200,
  // Action REFUSÉE par une règle métier — géofence anti-fraude : l'agent
  // tente de marquer "visité" hors du rayon autorisé. Motif distinct
  // (double pulsation) pour ne pas le confondre avec une simple erreur.
  blocked: [60, 40, 60],
  // Étape / point de passage franchi pendant un guidage.
  waypoint: [120, 80, 120]
});

/**
 * Déclenche une vibration.
 * @param {keyof typeof HAPTIC_PATTERNS | number | number[]} pattern - nom
 *   d'un motif prédéfini, ou une durée / séquence brute.
 * @returns {boolean} true si la vibration a été programmée par le navigateur.
 */
export function haptic(pattern) {
  const p = typeof pattern === "string" ? HAPTIC_PATTERNS[pattern] : pattern;
  if (p == null) return false;
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    return navigator.vibrate(p);
  } catch {
    return false;
  }
}
