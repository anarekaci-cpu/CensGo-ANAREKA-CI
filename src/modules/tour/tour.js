import { store } from "../../core/store.js";
import { flyToPoint } from "../map/map.js";
import { generateOptimizedTour } from "../../core/tourPlanner.js";
import { normalizePointId } from "../../core/utils.js";
import { lazyImport } from "../../core/lazyImport.js";
import { calculateRoute } from "../routing/routing.js";
import { log } from "../../core/debug.js";
import { logTourSession } from "../../db/database.js";

// Nombre d'étapes à venir dont l'itinéraire OSRM est préchargé — voir
// prefetchUpcomingLegs(). Volontairement borné : précharger toute la
// tournée (jusqu'à 150 arrêts) enverrait des dizaines de requêtes réseau
// inutiles pour des arrêts que l'agent n'atteindra peut-être jamais
// (visites hors ordre, tournée abandonnée en cours de route).
const PREFETCH_LEGS = 3;

let tourPoints = [];
let currentIndex = 0;
let pointsUnsub = null;
let openPopupTimer = null;
// Garde anti-double-log : stopTour() est appelée DEUX FOIS par arrêt naturel
// de tournée — une fois par l'appelant (bouton "Terminer" ou pointsUnsub
// quand filtered.length===0), une seconde fois par le subscriber
// "tour.active" ci-dessous (stopTour() y met lui-même active à false). Sans
// cette garde, la session serait journalisée deux fois dans tour_sessions
// (voir logTourSession() plus bas) à chaque tournée terminée.
let tourLogged = true;

export function initTour() {
  store.subscribe("tour.active", (active) => {
    if (!active) stopTour();
  });
}

export { generateOptimizedTour };

export function startTour(tour) {
  tourPoints = tour;
  currentIndex = 0;
  tourLogged = false;
  store.set("tour.active", true);
  store.set("tour.points", tour);
  store.set("tour.currentIndex", 0);
  // Snapshot séparé pour le rapport PDF (tourReport.js) — voir le commentaire
  // sur "tour.originalPoints" dans store.js : contrairement à "tour.points"
  // ci-dessus, celui-ci n'est JAMAIS filtré au fil des visites.
  store.set("tour.originalPoints", tour);
  store.set("tour.startedAt", new Date().toISOString());
  store.set("tour.endedAt", null);

  if (tour.length > 0) {
    goToPoint(0);
  }

  // S'abonner aux changements de points pour retirer dynamiquement les
  // points visités pendant la tournée — sinon l'agent voyait des stops
  // déjà traités rester dans la liste et le compteur ne diminuait pas.
  if (pointsUnsub) pointsUnsub();
  pointsUnsub = store.subscribe("points", (allPoints) => {
    if (!store.get("tour.active")) return;

    const visitedIds = new Set(allPoints.filter(p => p.visited).map(p => normalizePointId(p.id)));
    const filtered = tourPoints.filter(p => !visitedIds.has(normalizePointId(p.id)));

    if (filtered.length === 0) {
      stopTour();
      return;
    }

    // Ajuster l'index courant : si le point actuel a été visité, passer au suivant
    const currentPoint = tourPoints[currentIndex];
    tourPoints = filtered;
    const newIdx = currentPoint && !visitedIds.has(normalizePointId(currentPoint.id))
      ? filtered.findIndex(p => normalizePointId(p.id) === normalizePointId(currentPoint.id))
      : 0;
    currentIndex = Math.max(0, newIdx);

    store.set("tour.points", tourPoints);
    store.set("tour.currentIndex", currentIndex);
  });
}

export function goToNext() {
  if (currentIndex < tourPoints.length - 1) {
    currentIndex++;
    store.set("tour.currentIndex", currentIndex);
    goToPoint(currentIndex);
  }
}

/**
 * Précharge dans le cache du service worker (Workbox "osrm-routes",
 * StaleWhileRevalidate — voir vite.config.js) les itinéraires des
 * PREFETCH_LEGS prochaines étapes de la tournée, en chaînant la position
 * GPS actuelle -> tourPoints[index] -> tourPoints[index+1] -> ...
 *
 * Ces requêtes sont volontairement identiques à celles que navigation.js
 * enverra plus tard en arrivant à chaque étape : une fois en cache, elles
 * restent servables hors-ligne même si le réseau tombe entre-temps —
 * exactement le scénario terrain visé par le "Mode offline complet".
 * Best-effort : une étape déjà cachée ou une requête échouée n'interrompt
 * pas les suivantes, et aucune erreur ne remonte à l'agent (le guidage
 * en direct retentera de toute façon le calcul réel le moment venu).
 */
async function prefetchUpcomingLegs(fromIndex) {
  if (!navigator.onLine) return;

  const position = store.get("geo.position");
  let from = position ? { lat: position.lat, lon: position.lng } : null;

  const legs = tourPoints.slice(fromIndex, fromIndex + PREFETCH_LEGS);

  for (const stop of legs) {
    if (from) {
      try {
        await calculateRoute(from.lat, from.lon, stop.lat, stop.lon, store.get("navigation.mode"));
      } catch (err) {
        log.trace("TOUR", `prefetch échoué (${stop.id}):`, err?.message || err);
      }
    }
    from = { lat: stop.lat, lon: stop.lon };
  }
}

export function goToPoint(index) {
  const point = tourPoints[index];
  if (!point) return;
  flyToPoint(point.lat, point.lon, 17);
  prefetchUpcomingLegs(index);

  // Annuler le popup en attente d'un appel précédent : sans ça, des taps
  // rapprochés sur "suivant" empilaient un setTimeout par appel et chacun
  // finissait par ouvrir le popup du point qu'il ciblait, y compris des
  // points déjà dépassés — une rafale de popups se rouvrant après coup.
  if (openPopupTimer) clearTimeout(openPopupTimer);
  openPopupTimer = setTimeout(() => {
    openPopupTimer = null;
    lazyImport(() => import("../census/markers.js")).then(({ openPopup }) => {
      openPopup(point.id);
    });
  }, 1200);
}

export function stopTour() {
  // Distance approximative de la tournée (somme des distanceFromPrev posés
  // par generateOptimizedTour()/tourPlanner.js) — journalisée AVANT de vider
  // l'état, pour le rapport de paie par agent (voir
  // modules/report/agentReport.js). Approximation assumée avec
  // l'utilisateur : ne compte que les déplacements faits via "Tournée
  // optimisée", pas tout déplacement terrain (pas de vrai suivi GPS
  // historique dans ce projet).
  const originalPoints = store.get("tour.originalPoints") || [];
  const startedAt = store.get("tour.startedAt");
  const distanceKm = originalPoints.reduce((sum, p) => sum + (p.distanceFromPrev || 0), 0);
  const endedAt = new Date().toISOString();
  if (!tourLogged && startedAt && originalPoints.length > 0 && distanceKm > 0) {
    tourLogged = true;
    logTourSession({ distanceKm, stopCount: originalPoints.length, startedAt, endedAt })
      .catch(err => log.warn("TOUR", "Journalisation de la tournée échouée :", err?.message || err));
  }

  tourPoints = [];
  currentIndex = 0;
  if (pointsUnsub) {
    pointsUnsub();
    pointsUnsub = null;
  }
  if (openPopupTimer) {
    clearTimeout(openPopupTimer);
    openPopupTimer = null;
  }
  store.set("tour.active", false);
  store.set("tour.points", []);
  store.set("tour.currentIndex", 0);
  // "tour.originalPoints"/"tour.startedAt" restent volontairement en place
  // (pas remis à []/null) — le rapport PDF de LA DERNIÈRE tournée doit
  // rester générable après sa fin, jusqu'au prochain startTour().
  store.set("tour.endedAt", endedAt);
}
