import { describe, it, expect } from "vitest";
import { agentReportPeriodStart, computeAgentPeriodPoints, computeAgentPeriodDistance, buildAgentReportHtml } from "../modules/report/agentReport.js";

const NOW = new Date("2026-08-28T15:00:00");

describe("agentReportPeriodStart", () => {
  it("'day' -> minuit du jour courant", () => {
    expect(agentReportPeriodStart("day", NOW)).toEqual(new Date(2026, 7, 28));
  });

  it("'week' -> 7 derniers jours glissants (aujourd'hui inclus)", () => {
    expect(agentReportPeriodStart("week", NOW)).toEqual(new Date(2026, 7, 22));
  });

  it("'month' -> premier jour du mois courant", () => {
    expect(agentReportPeriodStart("month", NOW)).toEqual(new Date(2026, 7, 1));
  });

  it("'all' -> aucune borne", () => {
    expect(agentReportPeriodStart("all", NOW)).toBeNull();
  });
});

describe("computeAgentPeriodPoints", () => {
  const points = [
    { id: "a", createdBy: "u1", createdAt: "2026-08-28T08:00:00" }, // aujourd'hui
    { id: "b", createdBy: "u1", createdAt: "2026-08-20T08:00:00" }, // il y a 8 jours (hors semaine glissante)
    { id: "c", createdBy: "u1", createdAt: "2026-08-01T08:00:00" }, // ce mois, hors semaine
    { id: "d", createdBy: "u2", createdAt: "2026-08-28T08:00:00" }, // autre agent
    { id: "e", createdBy: "u1", createdAt: null } // fiche importée sans date connue
  ];

  it("filtre par agent ET par période 'day'", () => {
    const out = computeAgentPeriodPoints(points, "u1", "day", NOW);
    expect(out.map(p => p.id)).toEqual(["a"]);
  });

  it("filtre par agent ET par période 'week' (glissante, pas calendaire)", () => {
    const out = computeAgentPeriodPoints(points, "u1", "week", NOW);
    expect(out.map(p => p.id)).toEqual(["a"]);
  });

  it("période 'month' inclut tout le mois courant", () => {
    const out = computeAgentPeriodPoints(points, "u1", "month", NOW);
    expect(out.map(p => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("période 'all' inclut même les fiches sans createdAt connu", () => {
    const out = computeAgentPeriodPoints(points, "u1", "all", NOW);
    expect(out.map(p => p.id).sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("une fiche sans createdAt est exclue d'une période bornée (pas comptée par défaut)", () => {
    const out = computeAgentPeriodPoints(points, "u1", "day", NOW);
    expect(out.some(p => p.id === "e")).toBe(false);
  });

  it("n'inclut jamais les fiches d'un autre agent", () => {
    const out = computeAgentPeriodPoints(points, "u1", "all", NOW);
    expect(out.some(p => p.id === "d")).toBe(false);
  });
});

describe("computeAgentPeriodDistance", () => {
  const sessions = [
    { userId: "u1", distanceKm: 4.2, startedAt: "2026-08-28T08:00:00" }, // aujourd'hui
    { userId: "u1", distanceKm: 3.1, startedAt: "2026-08-20T08:00:00" }, // il y a 8 jours
    { userId: "u2", distanceKm: 9.9, startedAt: "2026-08-28T08:00:00" } // autre agent
  ];

  it("additionne les distances de l'agent sur la période", () => {
    expect(computeAgentPeriodDistance(sessions, "u1", "day", NOW)).toBeCloseTo(4.2);
    expect(computeAgentPeriodDistance(sessions, "u1", "all", NOW)).toBeCloseTo(7.3);
  });

  it("n'inclut jamais les tournées d'un autre agent", () => {
    expect(computeAgentPeriodDistance(sessions, "u2", "all", NOW)).toBeCloseTo(9.9);
    expect(computeAgentPeriodDistance(sessions, "u1", "all", NOW)).toBeCloseTo(7.3);
  });

  it("aucune session -> 0, jamais undefined/NaN", () => {
    expect(computeAgentPeriodDistance([], "u1", "all", NOW)).toBe(0);
    expect(computeAgentPeriodDistance(null, "u1", "all", NOW)).toBe(0);
  });
});

describe("buildAgentReportHtml", () => {
  it("compte fiches et visites dans le résumé", () => {
    const html = buildAgentReportHtml([
      { name: "Chez Awa", visited: true },
      { name: "Kiosque Bamba", visited: false }
    ], { agentName: "Kouassi Jean", period: "month" });

    expect(html).toContain("Kouassi Jean");
    expect(html).toContain("<b>2</b>");
    expect(html).toContain("<b>1</b>");
  });

  it("échappe les données utilisateur (pas d'injection HTML)", () => {
    const html = buildAgentReportHtml([{ name: "<script>alert(1)</script>", visited: false }]);
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("liste vide -> message plutôt qu'un tableau vide", () => {
    const html = buildAgentReportHtml([]);
    expect(html).toContain("Aucune fiche sur cette période");
  });
});
