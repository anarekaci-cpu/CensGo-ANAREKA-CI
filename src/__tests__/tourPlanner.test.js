import { describe, it, expect } from "vitest";
import { generateOptimizedTour, MAX_TOUR_STOPS } from "../core/tourPlanner.js";

// Abidjan ~ (5.35, -3.99)
const mkPoint = (id, lat, lon, visited = false) => ({ id, lat, lon, visited });

describe("generateOptimizedTour", () => {
  const start = { lat: 5.35, lng: -3.99 };

  it("ignore les points déjà visités", () => {
    const tour = generateOptimizedTour(
      [mkPoint("a", 5.36, -3.98, true), mkPoint("b", 5.37, -4.0, false)],
      start
    );
    expect(tour.map(p => p.id)).toEqual(["b"]);
  });

  it("ignore les points sans coordonnées valides", () => {
    const tour = generateOptimizedTour(
      [mkPoint("bad", null, null), mkPoint("ok", 5.36, -3.98)],
      start
    );
    expect(tour).toHaveLength(1);
    expect(tour[0].id).toBe("ok");
  });

  it("liste vide -> tournée vide", () => {
    expect(generateOptimizedTour([], start)).toEqual([]);
  });

  it("ordre plus-proche-voisin : le point adjacent vient en premier", () => {
    const tour = generateOptimizedTour([
      mkPoint("loin", 5.60, -4.30),
      mkPoint("proche", 5.3505, -3.9905),
      mkPoint("moyen", 5.40, -4.05)
    ], start);
    expect(tour[0].id).toBe("proche");
    expect(tour).toHaveLength(3);
  });

  it("chaque arrêt porte distanceFromPrev", () => {
    const tour = generateOptimizedTour([mkPoint("a", 5.36, -3.98), mkPoint("b", 5.37, -4.0)], start);
    expect(tour[0].distanceFromPrev).toBeGreaterThan(0);
    expect(typeof tour[1].distanceFromPrev).toBe("number");
  });

  it("plafonné à MAX_TOUR_STOPS — pas d'explosion O(N²) sur 10k points", () => {
    const pts = [];
    for (let i = 0; i < 10000; i++) {
      pts.push(mkPoint(`p${i}`, 5.0 + Math.random() * 1.0, -4.5 + Math.random() * 1.0));
    }
    const t0 = performance.now();
    const tour = generateOptimizedTour(pts, start);
    const ms = performance.now() - t0;
    expect(tour.length).toBe(MAX_TOUR_STOPS);
    // Sur un CPU moderne, le plafond doit garder ce calcul sous ~500ms
    // (le naïf sur 10k points prenait plusieurs secondes).
    expect(ms).toBeLessThan(500);
  });
});
