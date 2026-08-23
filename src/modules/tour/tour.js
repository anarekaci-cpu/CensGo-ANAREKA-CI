import { store } from "../../core/store.js";
import { flyToPoint } from "../map/map.js";
import { generateOptimizedTour } from "../../core/tourPlanner.js";
import { normalizePointId } from "../../core/utils.js";
import { lazyImport } from "../../core/lazyImport.js";

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

export function goToPoint(index) {
  const point = tourPoints[index];
  if (!point) return;
  flyToPoint(point.lat, point.lon, 17);

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
