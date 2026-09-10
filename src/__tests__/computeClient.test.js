import { describe, it, expect } from "vitest";
import { computeTourAsync, computeStatsAsync, filterPointsAsync } from "../core/computeClient.js";
import { generateOptimizedTour } from "../core/tourPlanner.js";
import { computeStats } from "../core/analytics.js";
import { filterPoints, DEFAULT_FILTERS } from "../core/filters.js";

// jsdom n'implémente pas Worker : ces tests exercent le REPLI SYNCHRONE du
// client, qui doit rendre un résultat rigoureusement identique aux fonctions
// pures sous-jacentes (le chemin Worker est le même code, exécuté ailleurs).

const mkPoint = (id, lat, lon, visited = false) => ({ id, lat, lon, visited, status: "VERT (Joignable)", quartier: "Cocody", activityType: "Kiosque" });

describe("computeClient — repli synchrone", () => {
  it("computeTourAsync == generateOptimizedTour", async () => {
    const pts = [mkPoint("a", 5.36, -3.98), mkPoint("b", 5.37, -4.0), mkPoint("c", 5.35, -3.99)];
    const start = { lat: 5.35, lng: -3.99 };
    const viaWorker = await computeTourAsync(pts, start);
    expect(viaWorker.map(p => p.id)).toEqual(generateOptimizedTour(pts, start).map(p => p.id));
  });

  it("computeTourAsync renvoie une Promise", () => {
    expect(computeTourAsync([], { lat: 0, lng: 0 })).toBeInstanceOf(Promise);
  });

  it("computeStatsAsync == computeStats", async () => {
    const pts = [mkPoint("a", 5.36, -3.98, true), mkPoint("b", 5.37, -4.0)];
    expect(await computeStatsAsync(pts)).toEqual(computeStats(pts));
  });

  it("filterPointsAsync == filterPoints", async () => {
    const pts = [mkPoint("a", 5.36, -3.98), { ...mkPoint("b", 5.37, -4.0), status: "ROUGE (Refus)" }];
    const f = { ...DEFAULT_FILTERS, status: "ROUGE (Refus)" };
    expect((await filterPointsAsync(pts, f)).map(p => p.id)).toEqual(filterPoints(pts, f).map(p => p.id));
  });

  it("propage les entrées dégénérées comme les fonctions pures (pas d'exception avalée)", async () => {
    expect(await computeTourAsync([], { lat: 0, lng: 0 })).toEqual([]);
    expect(await computeStatsAsync(null)).toEqual(computeStats(null));
  });
});
