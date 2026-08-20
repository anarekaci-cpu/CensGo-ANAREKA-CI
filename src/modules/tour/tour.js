import { store } from "../../core/store.js";
import { flyToPoint } from "../map/map.js";
import { haversineKm } from "../../core/geo.js";

let tourPoints = [];
let currentIndex = 0;
let pointsUnsub = null;

export function initTour() {
  store.subscribe("tour.active", (active) => {
    if (!active) stopTour();
  });
}

export function generateOptimizedTour(points, startPos) {
  const unvisited = points.filter(p => !p.visited);
  if (unvisited.length === 0) return [];

  const tour = [];
  let current = { lat: startPos.lat, lng: startPos.lng };
  const remaining = [...unvisited];

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lon);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }

    const next = remaining.splice(nearestIdx, 1)[0];
    tour.push({ ...next, distanceFromPrev: minDist });
    current = { lat: next.lat, lng: next.lon };
  }

  return tour;
}

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

    const visitedIds = new Set(allPoints.filter(p => p.visited).map(p => p.id));
    const filtered = tourPoints.filter(p => !visitedIds.has(p.id));

    if (filtered.length === 0) {
      stopTour();
      return;
    }

    // Ajuster l'index courant : si le point actuel a été visité, passer au suivant
    const currentPoint = tourPoints[currentIndex];
    tourPoints = filtered;
    const newIdx = currentPoint && !visitedIds.has(currentPoint.id)
      ? filtered.findIndex(p => p.id === currentPoint.id)
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
  setTimeout(() => {
    import("../census/markers.js").then(({ openPopup }) => {
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
  store.set("tour.active", false);
  store.set("tour.points", []);
  store.set("tour.currentIndex", 0);
}
