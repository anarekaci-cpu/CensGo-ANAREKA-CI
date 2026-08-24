import { describe, it, expect } from "vitest";
import { getRushHourFactor, isRushHour, getHeuristicCarSpeedMps } from "../modules/traffic/trafficHeuristic.js";
import { getTrafficFactor } from "../modules/routing/trafficHeuristic.js";

describe("trafficHeuristic", () => {
  it("détecte l'heure de pointe du matin (7h-9h)", () => {
    expect(isRushHour(new Date("2024-06-10T07:00:00"))).toBe(true);
    expect(isRushHour(new Date("2024-06-10T08:30:00"))).toBe(true);
    expect(isRushHour(new Date("2024-06-10T09:00:00"))).toBe(false); // borne exclusive
  });

  it("détecte l'heure de pointe du soir (17h-19h)", () => {
    expect(isRushHour(new Date("2024-06-10T17:00:00"))).toBe(true);
    expect(isRushHour(new Date("2024-06-10T18:59:00"))).toBe(true);
    expect(isRushHour(new Date("2024-06-10T19:00:00"))).toBe(false);
  });

  it("aucun ralentissement en heure creuse", () => {
    expect(isRushHour(new Date("2024-06-10T12:00:00"))).toBe(false);
    expect(isRushHour(new Date("2024-06-10T22:00:00"))).toBe(false);
    expect(getRushHourFactor(new Date("2024-06-10T12:00:00"))).toBe(1);
  });

  it("le facteur heure de pointe ralentit la vitesse voiture", () => {
    const base = 11.1;
    const rushHourSpeed = getHeuristicCarSpeedMps(base, new Date("2024-06-10T08:00:00"));
    const offPeakSpeed = getHeuristicCarSpeedMps(base, new Date("2024-06-10T12:00:00"));

    expect(offPeakSpeed).toBe(base);
    expect(rushHourSpeed).toBeLessThan(offPeakSpeed);
  });

  it("n'affecte ni piéton ni vélo", () => {
    const rush = new Date("2024-06-10T08:00:00");
    expect(getTrafficFactor(rush, "foot")).toBe(1);
    expect(getTrafficFactor(rush, "bike")).toBe(1);
  });

  it("reste neutre le weekend", () => {
    expect(getTrafficFactor(new Date("2024-06-15T08:00:00"), "car")).toBe(1);
  });
});
