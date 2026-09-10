import { describe, it, expect } from "vitest";
import {
  classifyConnection,
  resolveSyncIntervalMs,
  SYNC_INTERVAL_CAP_MS,
  LOW_BATTERY_THRESHOLD
} from "../core/networkQuality.js";

const BASE = 30000;

describe("classifyConnection", () => {
  it("effectiveType -> catégorie", () => {
    expect(classifyConnection({ effectiveType: "4g" })).toBe("fast");
    expect(classifyConnection({ effectiveType: "3g" })).toBe("moderate");
    expect(classifyConnection({ effectiveType: "2g" })).toBe("slow");
    expect(classifyConnection({ effectiveType: "slow-2g" })).toBe("verySlow");
  });

  it("API absente (aucun champ) -> fast (pas de pénalité)", () => {
    expect(classifyConnection()).toBe("fast");
    expect(classifyConnection({})).toBe("fast");
  });

  it("saveData respecté quel que soit le type", () => {
    expect(classifyConnection({ effectiveType: "4g", saveData: true })).toBe("slow");
  });
});

describe("resolveSyncIntervalMs", () => {
  it("réseau correct / batterie inconnue -> cadence nominale", () => {
    expect(resolveSyncIntervalMs(BASE, {})).toBe(BASE);
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "4g" })).toBe(BASE);
  });

  it("étire l'intervalle selon la lenteur du lien", () => {
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "3g" })).toBe(BASE * 1.5);
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "2g" })).toBe(BASE * 3);
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "slow-2g" })).toBe(BASE * 6);
  });

  it("batterie faible hors charge -> x2 supplémentaire", () => {
    expect(resolveSyncIntervalMs(BASE, { batteryLevel: LOW_BATTERY_THRESHOLD - 0.01, charging: false })).toBe(BASE * 2);
    // Cumulé avec un lien lent
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "2g", batteryLevel: 0.05, charging: false })).toBe(BASE * 6);
  });

  it("batterie faible MAIS en charge -> pas de pénalité batterie", () => {
    expect(resolveSyncIntervalMs(BASE, { batteryLevel: 0.05, charging: true })).toBe(BASE);
  });

  it("plafonné à SYNC_INTERVAL_CAP_MS", () => {
    expect(resolveSyncIntervalMs(BASE, { effectiveType: "slow-2g", batteryLevel: 0.01, charging: false }))
      .toBe(SYNC_INTERVAL_CAP_MS);
  });

  it("baseMs invalide -> repli sur 30000", () => {
    expect(resolveSyncIntervalMs(0, {})).toBe(30000);
    expect(resolveSyncIntervalMs(undefined, { effectiveType: "3g" })).toBe(45000);
  });
});
