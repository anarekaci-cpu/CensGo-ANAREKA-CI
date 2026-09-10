/**
 * Adaptation de la cadence de synchronisation au contexte réseau / batterie.
 * Logique PURE — testable isolément ; le wiring vit dans
 * modules/sync/syncEngine.js.
 *
 * Sur le terrain, un agent passe parfois des heures en EDGE/2G ou avec un
 * téléphone à 8 %. Marteler la file de sync toutes les 30 s y est
 * contre-productif : chaque tentative draine la batterie et sature un lien
 * déjà à genoux sans plus aboutir. On étire alors l'intervalle ; on revient
 * à la cadence nominale dès que les conditions redeviennent correctes.
 *
 * Entrées : navigator.connection (Network Information API — Chrome/Android,
 * absente ailleurs) et l'API Battery. Toutes deux optionnelles : sans info,
 * on ne pénalise pas (multiplicateur 1).
 */

export const SYNC_INTERVAL_MULTIPLIERS = Object.freeze({
  fast: 1,
  moderate: 1.5,
  slow: 3,
  verySlow: 6
});

// Plafond dur : un agent qui repasse en ligne brièvement ne doit pas rater
// sa fenêtre parce que le prochain tick est dans 20 min.
export const SYNC_INTERVAL_CAP_MS = 5 * 60 * 1000;

// En dessous de ce niveau et hors charge : on double encore l'intervalle.
export const LOW_BATTERY_THRESHOLD = 0.15;

/**
 * Classe la qualité du lien à partir de navigator.connection.
 * @param {{effectiveType?:string, saveData?:boolean}} [conn]
 * @returns {"fast"|"moderate"|"slow"|"verySlow"}
 */
export function classifyConnection({ effectiveType, saveData } = {}) {
  // "Économiseur de données" activé par l'utilisateur : respecter ce choix.
  if (saveData === true) return "slow";
  switch (effectiveType) {
    case "slow-2g": return "verySlow";
    case "2g": return "slow";
    case "3g": return "moderate";
    default: return "fast"; // 4g, 5g, ou API absente -> pas de pénalité
  }
}

/**
 * Intervalle de synchronisation effectif (ms).
 * @param {number} baseMs - cadence nominale (CONFIG.SYNC_INTERVAL_MS).
 * @param {object} [ctx]
 * @param {string} [ctx.effectiveType] - navigator.connection.effectiveType
 * @param {boolean} [ctx.saveData] - navigator.connection.saveData
 * @param {number|null} [ctx.batteryLevel] - 0..1, ou null si inconnu
 * @param {boolean|null} [ctx.charging]
 * @returns {number} intervalle en ms, borné à SYNC_INTERVAL_CAP_MS.
 */
export function resolveSyncIntervalMs(baseMs, { effectiveType, saveData, batteryLevel, charging } = {}) {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 30000;
  let mult = SYNC_INTERVAL_MULTIPLIERS[classifyConnection({ effectiveType, saveData })] ?? 1;

  const lowBattery =
    Number.isFinite(batteryLevel) && batteryLevel <= LOW_BATTERY_THRESHOLD && charging !== true;
  if (lowBattery) mult *= 2;

  return Math.min(SYNC_INTERVAL_CAP_MS, Math.round(base * mult));
}
