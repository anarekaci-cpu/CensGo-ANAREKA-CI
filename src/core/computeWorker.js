/**
 * Web Worker de calcul — déporte hors du thread principal la logique PURE et
 * potentiellement lourde du noyau : planification de tournée
 * (plus-proche-voisin pondéré + 2-opt, O(K²) sur K arrêts), statistiques
 * (O(N) sur tout le recensement) et filtrage (O(N)). Sur 50 000+ points, ces
 * calculs bloquaient sinon le thread UI le temps d'une frame ou plus, faisant
 * chuter le défilement de la carte sous les 60 FPS.
 *
 * Aucun accès DOM / store / réseau ici : uniquement des fonctions pures
 * appelées avec des données brutes transmises par postMessage (clonage
 * structuré). Le repli synchrone côté client (core/computeClient.js) garantit
 * un résultat identique si les Workers sont indisponibles (jsdom, très vieux
 * navigateur) ou si le Worker tarde.
 */

import { generateOptimizedTour } from "./tourPlanner.js";
import { computeStats } from "./analytics.js";
import { filterPoints } from "./filters.js";

const OPS = {
  tour: generateOptimizedTour,
  stats: computeStats,
  filter: filterPoints
};

self.addEventListener("message", (e) => {
  const { id, op, args } = e.data || {};
  try {
    const fn = OPS[op];
    if (typeof fn !== "function") throw new Error(`Opération de calcul inconnue : ${op}`);
    self.postMessage({ id, result: fn(...(args || [])) });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
});
