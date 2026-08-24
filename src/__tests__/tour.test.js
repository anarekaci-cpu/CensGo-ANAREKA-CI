import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../modules/map/map.js", () => ({
  flyToPoint: vi.fn()
}));
vi.mock("../modules/routing/routing.js", () => ({
  calculateRoute: vi.fn(async () => ({ distance: 100, duration: 60 }))
}));

const { store } = await import("../core/store.js");
const { startTour, stopTour } = await import("../modules/tour/tour.js");

const stops = [
  { id: "a1", name: "Chez Awa", lat: 5.36, lon: -3.97 },
  { id: "a2", name: "Kiosque Bamba", lat: 5.37, lon: -3.98 }
];

describe("tour.js — snapshot pour le rapport PDF (tour.originalPoints)", () => {
  beforeEach(() => {
    stopTour();
  });

  it("startTour() fige un snapshot complet dans tour.originalPoints, distinct de tour.points", () => {
    startTour(stops);

    expect(store.get("tour.originalPoints")).toEqual(stops);
    expect(store.get("tour.startedAt")).not.toBeNull();
    expect(store.get("tour.endedAt")).toBeNull();
  });

  it("tour.points se réduit au fil des visites mais tour.originalPoints n'est jamais modifié", async () => {
    startTour(stops);

    // Simule la visite de "a1" : le store "points" (source réelle des
    // fiches) marque le point visité, ce que tour.js écoute pour retirer
    // l'arrêt de la liste EN COURS (tour.points) — voir startTour(). Les
    // notifications du store sont batchées via requestAnimationFrame
    // (core/store.js), d'où l'attente ci-dessous avant de lire l'effet.
    store.set("points", [
      { id: "a1", visited: true },
      { id: "a2", visited: false }
    ]);
    await new Promise(resolve => requestAnimationFrame(resolve));

    expect(store.get("tour.points").map(p => p.id)).toEqual(["a2"]);
    expect(store.get("tour.originalPoints").map(p => p.id)).toEqual(["a1", "a2"]);
  });

  it("stopTour() horodate la fin mais NE VIDE PAS originalPoints/startedAt (rapport encore générable après)", () => {
    startTour(stops);
    const startedAt = store.get("tour.startedAt");

    stopTour();

    expect(store.get("tour.active")).toBe(false);
    expect(store.get("tour.points")).toEqual([]);
    expect(store.get("tour.originalPoints")).toEqual(stops);
    expect(store.get("tour.startedAt")).toBe(startedAt);
    expect(store.get("tour.endedAt")).not.toBeNull();
  });

  it("une nouvelle tournée remplace le snapshot précédent", () => {
    startTour(stops);
    stopTour();

    const secondTour = [{ id: "b1", name: "Autre point", lat: 5.4, lon: -4.0 }];
    startTour(secondTour);

    expect(store.get("tour.originalPoints")).toEqual(secondTour);
    expect(store.get("tour.endedAt")).toBeNull();
  });
});
