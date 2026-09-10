/**
 * Entretien de la file de synchronisation (syncQueue) — logique PURE,
 * testable isolément. Le wiring Dexie vit dans db/database.js (purgeSyncQueue).
 *
 * Les entrées réellement synchronisées sont supprimées à la volée par
 * markSyncDone(). Ce module ne décrit QUE ce qu'il reste à balayer
 * périodiquement pour qu'une PWA installée depuis des mois ne traîne pas une
 * table qui gonfle :
 *  - reliquats d'un état terminal jamais nettoyé (ancien statut "failed"/
 *    "done" d'avant le correctif dead-letter) ;
 *  - échecs définitifs ("dead") trop anciens pour rester pertinents — l'agent
 *    les a forcément vus passer dans le bandeau de sync, et ils ne se
 *    résoudront jamais seuls.
 */

// 14 jours : large marge même pour un agent resté hors ligne longtemps.
export const DEAD_SYNC_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @param {{status?:string, createdAt?:string}} item - entrée syncQueue.
 * @param {object} [opts]
 * @param {number} [opts.maxDeadAgeMs=DEAD_SYNC_MAX_AGE_MS]
 * @param {number} [opts.now=Date.now()]
 * @returns {boolean} true si l'entrée peut être supprimée sans perte.
 */
export function isPurgeableSyncItem(item, { maxDeadAgeMs = DEAD_SYNC_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!item) return false;
  // État terminal orphelin : tout ce qui n'est ni "pending" ni "dead" ne
  // sera jamais repris par getPendingSyncs()/getDeadSyncs().
  if (item.status !== "pending" && item.status !== "dead") return true;
  if (item.status === "dead") {
    const ts = Date.parse(item.createdAt || "");
    if (Number.isFinite(ts) && now - ts > maxDeadAgeMs) return true;
  }
  return false;
}
