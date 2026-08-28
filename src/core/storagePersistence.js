import { log } from "./debug.js";

/**
 * Demande au navigateur d'exempter les données locales (IndexedDB — fiches
 * terrain, file de sync, brouillons) de l'éviction automatique en cas de
 * pression de stockage sur l'appareil. Sans ça, un téléphone à court
 * d'espace peut effacer silencieusement des fiches non encore synchronisées.
 *
 * Best-effort volontairement : le navigateur peut refuser (ou l'API être
 * absente) sans que l'app cesse de fonctionner — la synchronisation reste
 * la protection principale contre la perte de données.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;

  try {
    const alreadyPersisted = await navigator.storage.persisted?.();
    if (alreadyPersisted) return true;

    const granted = await navigator.storage.persist();
    log.info("STORAGE", granted
      ? "Stockage persistant accordé — données locales protégées de l'éviction automatique."
      : "Stockage persistant refusé par le navigateur.");
    return granted;
  } catch {
    return null;
  }
}
