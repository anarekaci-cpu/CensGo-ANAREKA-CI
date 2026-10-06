/**
 * Classification des erreurs de sync — logique PURE.
 *
 * Transitoire : réseau coupé, timeout, 5xx, 408/429, erreurs de connexion/
 * ressources PostgreSQL. Un nouvel essai automatique peut réussir.
 * Permanente : 4xx, 42501 (RLS), erreurs métier (géofence P0001...),
 * violations de contraintes. Un essai automatique ne changerait rien et
 * pourrait même répéter une écriture refusée : l'item reste "dead" jusqu'à
 * une action explicite de l'agent.
 */

// SQLSTATE réessayables : classe 08 (connexion), 53 (ressources), 57014
// (statement timeout), 40001/40P01 (sérialisation/deadlock).
const TRANSIENT_SQLSTATE = /^(08|53)/;
const TRANSIENT_SQLSTATE_EXACT = new Set(["57014", "40001", "40P01"]);
const NETWORK_MESSAGE = /timeout|timed out|abort|network|failed to fetch|fetch failed|load failed|offline|trop long|indisponible|ECONN|ETIMEDOUT/i;

/**
 * @param {{message?:string, code?:string, status?:number, name?:string}|null} err
 * @returns {boolean} true si l'échec est transitoire.
 */
export function isTransientSyncError(err) {
  if (!err) return true;
  const status = Number(err.status);
  if (Number.isFinite(status) && status > 0) {
    if (status >= 500 || status === 408 || status === 429) return true;
    if (status >= 400) return false;
  }
  const code = String(err.code || "");
  const msg = `${err.name || ""} ${err.message || String(err)}`;
  if (code) {
    if (TRANSIENT_SQLSTATE.test(code) || TRANSIENT_SQLSTATE_EXACT.has(code)) return true;
    // Tout autre code (42501, P0001, 23xxx, PGRSTxxx...) = refus définitif,
    // sauf si le message trahit clairement un problème réseau.
    return NETWORK_MESSAGE.test(msg) && !/row-level security/i.test(msg);
  }
  if (/row-level security|violates|permission denied|not authorized|forbidden|trop loin|g[ée]ofence/i.test(msg)) return false;
  // Sans code ni statut (TypeError fetch, AbortError, erreur inconnue) :
  // on suppose transitoire, c'est le cas dominant sur réseau terrain.
  return true;
}
