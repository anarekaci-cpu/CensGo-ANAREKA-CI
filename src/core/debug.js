/**
 * Logger de diagnostic (Problème #22).
 *
 * Logs préfixés par domaine ([MARKER], [POPUP], [ROUTE], [GPS]...) pour
 * suivre en terrain les flux critiques. Deux niveaux :
 *   - always  : toujours affiché (événements rares et significatifs)
 *   - verbose : uniquement si localStorage.DEBUG est truthy (debug terrain)
 *
 * Activation : localStorage.setItem("DEBUG", "1") puis recharger.
 */

const VERBOSE = (() => {
  try {
    return Boolean(localStorage.getItem("DEBUG"));
  } catch {
    return false;
  }
})();

/** Expose le flag DEBUG aux appelants qui doivent éviter du travail coûteux
 * (ex: forcer un reflow pour un diagnostic) quand le mode verbeux est off. */
export function isVerbose() {
  return VERBOSE;
}

function fmt(parts) {
  return [`%c${parts[0]}`, "font-weight:700;color:#0e7490;", ...parts.slice(1)];
}

export const log = {
  /** Toujours affiché — événements rares (clic, erreur, route calculée). */
  info(tag, ...args) {
    console.info(...fmt([`[${tag}]`, ...args]));
  },
  warn(tag, ...args) {
    console.warn(`[${tag}]`, ...args);
  },
  error(tag, ...args) {
    console.error(`[${tag}]`, ...args);
  },
  /** Affiché seulement en mode DEBUG — flux à fort volume. */
  debug(tag, ...args) {
    if (!VERBOSE) return;
    console.log(...fmt([`[${tag}]`, ...args]));
  },
  /**
   * Traçage de flux au format [DEBUG][TAG] — suit exactement l'exécution
   * (START/END/gardes silencieux). Actif avec localStorage.DEBUG=1.
   */
  trace(tag, ...args) {
    if (!VERBOSE) return;
    console.log(`[DEBUG][${tag}]`, ...args);
  },
  /** Traçage toujours affiché (diagnostic terrain ponctuel). */
  traceAlways(tag, ...args) {
    console.log(`[DEBUG][${tag}]`, ...args);
  }
};
