import { describe, it, expect } from "vitest";
import { computeLearnedWalkingSpeedMps } from "../modules/routing/walkingSpeedLearning.js";

function session(distanceKm, durationMinutes, startedAt = "2026-08-01T08:00:00.000Z") {
  const start = new Date(startedAt);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { distanceKm, startedAt: start.toISOString(), endedAt: end.toISOString() };
}

describe("computeLearnedWalkingSpeedMps", () => {
  it("retourne null sans données", () => {
    expect(computeLearnedWalkingSpeedMps([])).toBeNull();
    expect(computeLearnedWalkingSpeedMps(null)).toBeNull();
    expect(computeLearnedWalkingSpeedMps(undefined)).toBeNull();
  });

  it("retourne null sous le seuil minimal de sessions/distance cumulée", () => {
    // 2 sessions valides seulement (< MIN_SESSION_COUNT = 3).
    const sessions = [session(1, 15), session(1, 15)];
    expect(computeLearnedWalkingSpeedMps(sessions)).toBeNull();
  });

  it("calcule une moyenne pondérée par la distance, pas une moyenne simple des vitesses", () => {
    // 1 km en 20 min (0.833 m/s) + 4 km en 40 min (1.667 m/s) + 1 km en 15 min (1.111 m/s)
    // Moyenne simple des 3 vitesses ≈ 1.20 m/s ; pondérée (6000m / 4500s) ≈ 1.333 m/s.
    const sessions = [session(1, 20), session(4, 40), session(1, 15)];
    const result = computeLearnedWalkingSpeedMps(sessions);
    expect(result).toBeCloseTo(6000 / (75 * 60), 3);
  });

  it("ignore les sessions trop courtes en distance ou en durée", () => {
    const tooShortDistance = session(0.05, 10); // < 100m
    const tooShortDuration = session(1, 0.5); // 30s < 60s
    const valid = [session(1, 20), session(2, 30), session(1.5, 25)];
    const withNoise = [tooShortDistance, tooShortDuration, ...valid];

    expect(computeLearnedWalkingSpeedMps(withNoise)).toEqual(computeLearnedWalkingSpeedMps(valid));
  });

  it("ignore les sessions à vitesse implausible (trop lente ou trop rapide)", () => {
    const tooSlow = session(1, 120); // ~0.14 m/s — arrêts prolongés
    const tooFast = session(5, 10); // ~8.3 m/s — déplacement assisté
    const valid = [session(1, 20), session(2, 30), session(1.5, 25)];
    const withNoise = [tooSlow, tooFast, ...valid];

    expect(computeLearnedWalkingSpeedMps(withNoise)).toEqual(computeLearnedWalkingSpeedMps(valid));
  });

  it("ignore les entrées avec des dates invalides", () => {
    const valid = [session(1, 20), session(2, 30), session(1.5, 25)];
    const malformed = [{ distanceKm: 1, startedAt: "invalide", endedAt: "invalide" }, ...valid];

    expect(computeLearnedWalkingSpeedMps(malformed)).toEqual(computeLearnedWalkingSpeedMps(valid));
  });
});
