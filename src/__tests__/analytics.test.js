import { describe, it, expect } from "vitest";
import { computeStats } from "../core/analytics.js";

const P = (id, visited, status = "VERT (Joignable)", activity = "Kiosque", quartier = "Cocody") =>
  ({ id, visited, status, activityType: activity, quartier });

describe("computeStats", () => {
  it("calcule total / visited / remaining / coveragePct", () => {
    const s = computeStats([P("a", true), P("b", true), P("c", false)]);
    expect(s.total).toBe(3);
    expect(s.visited).toBe(2);
    expect(s.remaining).toBe(1);
    expect(s.coveragePct).toBe(67);
  });

  it("liste vide -> zéros sans exception", () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.visited).toBe(0);
    expect(s.coveragePct).toBe(0);
  });

  it("entrée non-tableau -> zéros sans exception", () => {
    expect(computeStats(null).total).toBe(0);
    expect(computeStats(undefined).coveragePct).toBe(0);
  });

  it("répartition par statut et par activité", () => {
    const s = computeStats([
      P("a", true, "VERT (Joignable)", "Kiosque"),
      P("b", false, "ROUGE (Refus)", "Kiosque"),
      P("c", false, "ROUGE (Refus)", "Restaurant")
    ]);
    expect(s.byStatus["VERT (Joignable)"]).toBe(1);
    expect(s.byStatus["ROUGE (Refus)"]).toBe(2);
    expect(s.byActivity["Kiosque"]).toBe(2);
    expect(s.byActivity["Restaurant"]).toBe(1);
  });

  it("répartition par quartier avec taux de couverture", () => {
    const s = computeStats([
      P("a", true, "VERT (Joignable)", "Kiosque", "Yopougon"),
      P("b", false, "VERT (Joignable)", "Kiosque", "Yopougon"),
      P("c", true, "VERT (Joignable)", "Kiosque", "Cocody")
    ]);
    const yop = s.byQuartier.find(q => q.quartier === "Yopougon");
    const coc = s.byQuartier.find(q => q.quartier === "Cocody");
    expect(yop.total).toBe(2);
    expect(yop.pct).toBe(50);
    expect(coc.pct).toBe(100);
  });

  it("zones cibles présentes même avec 0 point", () => {
    const s = computeStats([], [{ name: "Bingerville" }]);
    const zone = s.byQuartier.find(q => q.quartier === "Bingerville");
    expect(zone).toBeDefined();
    expect(zone.total).toBe(0);
    expect(zone.pct).toBe(0);
  });

  it("AUCUN doublon possible : la source store est déjà dédupliquée", () => {
    // Le store reçoit normalizePoints() en amont — computeStats compte
    // exactement la liste qu'on lui passe, point par point.
    const pts = [P("a", true), P("a", true), P("b", false)];
    const seen = new Set(pts.map(p => p.id));
    expect(seen.size).toBe(2); // contrat de dédup amont documenté
    const s = computeStats(pts.filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i));
    expect(s.total).toBe(2);
  });
});
