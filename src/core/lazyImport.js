import { toastInfo } from "./toast.js";

// Clé de garde en sessionStorage : évite une boucle de reload infinie si le
// rechargement lui-même échoue à récupérer un module valide (ex: coupure
// réseau totale au moment du clic) — on ne retente le reload automatique
// qu'une seule fois par session d'onglet.
const RELOAD_GUARD_KEY = "anareka_chunk_reload_attempted";

/**
 * Enrobe un import() dynamique pour survivre au cas classique Vite + PWA :
 * un onglet resté ouvert à cheval sur un déploiement GitHub Pages référence
 * encore un chunk (ex: tour-XXXX.js) dont le NOM DE FICHIER a changé au
 * build suivant — l'ancien fichier n'existe plus sur le serveur (GitHub
 * Pages remplace intégralement dist/ à chaque déploiement), et le Service
 * Worker en cours de renouvellement (registerType: "autoUpdate") ne le
 * précache plus non plus. Sans ce filet, l'échec restait une promesse
 * rejetée non gérée : aucun message, l'action (ex: "Tournée optimisée")
 * ne se produisait simplement jamais, sans aucune trace pour l'agent.
 *
 * @param {() => Promise<any>} importFn - fonction retournant l'import() à exécuter
 * @returns {Promise<any>}
 */
export async function lazyImport(importFn) {
  try {
    return await importFn();
  } catch (err) {
    const isChunkLoadError = /Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(err?.message || "");
    if (!isChunkLoadError) throw err;

    if (sessionStorage.getItem(RELOAD_GUARD_KEY)) {
      // Déjà tenté un reload cette session sans succès — éviter la boucle,
      // laisser l'erreur remonter pour un message d'échec normal.
      throw err;
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    toastInfo("Nouvelle version disponible — actualisation en cours…");
    setTimeout(() => window.location.reload(), 900);
    // Promesse jamais résolue : la page recharge avant que l'appelant
    // n'ait besoin d'une valeur de retour.
    return new Promise(() => {});
  }
}
