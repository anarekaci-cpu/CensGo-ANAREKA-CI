import { store } from "../../core/store.js";
import { flyToPoint } from "../map/map.js";
import { calculateRoute } from "../routing/routing.js";

let tourPoints = [];
let currentIndex = 0;

export function initTour() {
  store.subscribe("tour.active", (active) => {
    if (!active) stopTour();
  });
}

export function generateOptimizedTour(points, startPos) {
  // Algorithme du plus proche voisin (TSP greedy)
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
  // Ouvrir popup après animation
  setTimeout(() => {
    const { openPopup } = require("../census/markers.js");
    openPopup(point.id);
  }, 1200);
}

export function stopTour() {
  tourPoints = [];
  currentIndex = 0;
  store.set("tour.active", false);
  store.set("tour.points", []);
  store.set("tour.currentIndex", 0);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
