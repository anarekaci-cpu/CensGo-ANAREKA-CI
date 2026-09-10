/**
 * Backoff exponentiel pour les réessais de la file de synchronisation
 * (modules/sync/syncEngine.js, db/database.js). Logique PURE — aucun import,
 * testable isolément.
 *
 * Problème (terrain) : sur un réseau mobile instable (2G intermittent,
 * tunnel, bordure de zone couverte), une opération de sync qui échoue était
 * aussitôt remise en tête de file. L'intervalle de 30 s (SYNC_INTERVAL_MS),
 * et SURTOUT chaque bascule "online" de l'OS quand la connexion clignote,
 * la retentaient immédiatement — potentiellement des dizaines de requêtes
 * identiques par minute vers Supabase pour rien, pendant que rien ne peut
 * aboutir de toute façon.
 *
 * Correctif : on espace les réessais d'une MÊME opération de façon
 * croissante (1 s, 2 s, 4 s, 8 s… plafonné à 5 min), avec un bruit
 * aléatoire (jitter) additif pour éviter que toutes les opérations en
 * attente ne repartent en rafale synchronisée à l'instant précis où la
 * connexion revient. Chaque item porte alors un `nextRetryAt` (ISO) ;
 * syncEngine n'envoie que les items dont l'échéance est passée.
 */

// Délai de base : première nouvelle tentative ~1 s après un échec.
export const BACKOFF_BASE_MS = 1000;
// Plafond : au-delà, attendre plus longtemps n'apporte rien — l'intervalle
// périodique (SYNC_INTERVAL_MS) et l'événement "online" repasseront de
// toute façon. 5 min = même ordre de grandeur que DEAD_RETRY_INTERVAL_MS.
export const BACKOFF_CAP_MS = 5 * 60 * 1000;
// Amplitude du jitter, en fraction du délai calculé (0.25 => +0 à +25 %).
export const BACKOFF_JITTER_RATIO = 0.25;

/**
 * Délai (ms) avant la prochaine tentative, pour un item ayant déjà échoué
 * `attempts` fois. Croissance exponentielle plafonnée + jitter additif.
 *
 * @param {number} attempts - nombre de tentatives déjà effectuées (>= 1).
 * @param {object} [opts]
 * @param {number} [opts.base=BACKOFF_BASE_MS]
 * @param {number} [opts.cap=BACKOFF_CAP_MS]
 * @param {number} [opts.jitterRatio=BACKOFF_JITTER_RATIO]
 * @param {() => number} [opts.random=Math.random] - injectable pour les tests.
 * @returns {number} délai en millisecondes, arrondi.
 */
export function backoffDelayMs(attempts, {
  base = BACKOFF_BASE_MS,
  cap = BACKOFF_CAP_MS,
  jitterRatio = BACKOFF_JITTER_RATIO,
  random = Math.random
} = {}) {
  const n = Math.max(1, Math.floor(Number(attempts) || 1));
  // 2 ** (n - 1) peut exploser pour un n aberrant : on plafonne AVANT de
  // multiplier pour ne jamais manipuler d'Infinity.
  const exp = n - 1 >= 30 ? cap : Math.min(cap, base * 2 ** (n - 1));
  const jitter = exp * Math.max(0, jitterRatio) * random();
  return Math.round(exp + jitter);
}

/**
 * Horodatage ISO de la prochaine tentative autorisée pour un item ayant
 * échoué `attempts` fois. Stocké tel quel dans la ligne syncQueue.
 *
 * @param {number} attempts
 * @param {number} [nowMs=Date.now()]
 * @param {object} [opts] - transmis à backoffDelayMs().
 * @returns {string} date ISO 8601.
 */
export function nextRetryAtIso(attempts, nowMs = Date.now(), opts) {
  return new Date(nowMs + backoffDelayMs(attempts, opts)).toISOString();
}

/**
 * True si l'item peut être retenté maintenant : soit il n'a pas de
 * `nextRetryAt` (jamais échoué, ou champ absent d'une version antérieure),
 * soit son échéance est passée. Un `nextRetryAt` illisible est traité comme
 * "dû" plutôt que de bloquer l'item indéfiniment.
 *
 * @param {{nextRetryAt?: string}} item
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
export function isRetryDue(item, nowMs = Date.now()) {
  if (!item || !item.nextRetryAt) return true;
  const t = Date.parse(item.nextRetryAt);
  return Number.isNaN(t) || t <= nowMs;
}
