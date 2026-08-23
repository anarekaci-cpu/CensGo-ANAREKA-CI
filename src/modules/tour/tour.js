import { store } from "../../core/store.js";
import { flyToPoint } from "../map/map.js";
import { generateOptimizedTour } from "../../core/tourPlanner.js";
import { normalizePointId } from "../../core/utils.js";
import { lazyImport } from "../../core/lazyImport.js";
import { calculateRoute } from "../routing/routing.js";
import { log } from "../../core/debug.js";

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

export function initTour() {
  store.subscribe("tour.active", (active) => {
    if (!active) stopTour();
  });
}

export { generateOptimizedTour };

export function startTour(tour) {
  tourPoints = tour;
  currentIndex = 0;
  store.set("tour.active", true);
  store.set("tour.points", tour);
  store.set("tour.currentIndex", 0);

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
}
