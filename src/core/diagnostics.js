import { store } from "./store.js";
import { log } from "./debug.js";

/**
 * OUTIL DE DIAGNOSTIC TERRAIN — inactif par défaut.
 *
 * Activé avec localStorage.DIAG=1 AVANT le chargement :
 *   localStorage.setItem("DIAG", "1"); location.reload();
 *
 * Permet de reproduire le flux complet (carte -> clic -> popup -> itinéraire)
 * sans identifiants Supabase : session factice + jeu de points synthétiques
 * autour d'Abidjan injectés dans IndexedDB si la base locale est vide.
 * Aucun effet en production tant que le flag n'est pas posé.
 */

const DIAG_ENABLED = (() => {
  try {
    return localStorage.getItem("DIAG") === "1";
  } catch {
    return false;
  }
})();

export function isDiagEnabled() {
  return DIAG_ENABLED;
}

/** Session factice : permet d'atteindre la vue authentifiée pour diagnostiquer. */
export function diagInstallFakeUser() {
  if (!DIAG_ENABLED) return false;
  store.set("user", { id: "diag-agent", email: "diag@anareka.ci" });
  log.info("DIAG", "session factice installée (localStorage.DIAG=1)");
  return true;
}

/**
 * Injecte des points de test dans IndexedDB si elle est vide.
 * IDs volontairement MIXTES (number / string UUID / string numérique) pour
 * reproduire les conditions réelles de désalignement marker/store.
 */
export async function diagSeedPointsIfEmpty(db) {
  if (!DIAG_ENABLED) return 0;
  const count = await db.points.count();
  if (count > 0) {
    log.info("DIAG", `IndexedDB déjà peuplée (${count} points) — pas de seed`);
    return 0;
  }

  const center = { lat: 5.36, lon: -3.996 }; // Abidjan Plateau
  const names = ["Chez Awa", "Kiosque Bamba", "Restaurant Le Baobab", "Garba de Adjamé", "Attiéké Express", "Maquis Bonoumin"];
  const quartiers = ["Plateau", "Adjamé", "Cocody", "Yopougon", "Marcory", "Bonoumin"];
  const statuses = ["VERT (Joignable)", "ROUGE (Absent)", "NON DEFINI"];

  const rows = [];
  for (let i = 0; i < 60; i++) {
    // Dispersion ~3 km autour du centre
    const lat = center.lat + (Math.random() - 0.5) * 0.05;
    const lon = center.lon + (Math.random() - 0.5) * 0.05;
    let id;
    if (i % 3 === 0) id = 1000 + i;                    // number (vieux cache Supabase)
    else if (i % 3 === 1) id = `arka_diag-${i}`;       // string UUID offline
    else id = String(2000 + i);                        // string numérique
    rows.push({
      id,
      block: (i % 5) + 1,
      order: i + 1,
      name: `${names[i % names.length]} ${i}`,
      tel: `07${String(10000000 + i).slice(0, 8)}`,
      etablissement: `Étab ${i}`,
      activityType: i % 2 ? "Kiosque d'attiéké" : "Restaurant",
      quartier: quartiers[i % quartiers.length],
      address: `Rue ${i % 20}, Villa ${i}`,
      produits: "Attiéké, poisson",
      sexe: i % 2 ? "Femme" : "Homme",
      status: statuses[i % statuses.length],
      visited: false,
      lat,
      lon,
      syncedAt: null,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: "diag-agent",
      zone: quartiers[i % quartiers.length]
    });
  }
  await db.points.bulkAdd(rows);
  log.info("DIAG", `${rows.length} points de diagnostic injectés dans IndexedDB`);
  return rows.length;
}
