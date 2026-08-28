import { log } from "./debug.js";

let wakeLockSentinel = null;
let wantWakeLock = false;

async function acquire() {
  if (!("wakeLock" in navigator)) return;

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch (err) {
    // Refusé (onglet en arrière-plan au moment de la demande, restriction
    // spécifique à l'appareil...) — la navigation continue sans verrou
    // d'écran, ce n'est pas une erreur bloquante.
    log.warn("WAKELOCK", err?.message || err);
  }
}

// Le verrou est automatiquement relâché par le navigateur dès que l'onglet
// perd la visibilité (écran verrouillé, changement d'appli) — sans cette
// ré-acquisition, revenir sur l'app pendant une navigation encore active
// laissait l'écran s'éteindre à nouveau au lieu de rester allumé.
function handleVisibilityChange() {
  if (wantWakeLock && document.visibilityState === "visible" && !wakeLockSentinel) {
    acquire();
  }
}

/**
 * Maintient l'écran allumé pendant une navigation active — l'agent suit un
 * guidage pas-à-pas en marchant, téléphone en main ; un écran qui s'éteint
 * coupe l'affichage du prochain maneuver. Best-effort et silencieux si
 * l'API est absente ou refusée : la navigation (voix, vibration à
 * l'arrivée) reste pleinement fonctionnelle dans tous les cas.
 */
export function enableNavigationWakeLock() {
  if (wantWakeLock) return;
  wantWakeLock = true;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  acquire();
}

export function disableNavigationWakeLock() {
  wantWakeLock = false;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  const sentinel = wakeLockSentinel;
  wakeLockSentinel = null;
  sentinel?.release().catch(() => {});
}
