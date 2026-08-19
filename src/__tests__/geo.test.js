import { describe, it, expect } from "vitest";
import { haversineKm } from "../core/geo.js";

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    expect(haversineKm(5.3600, -3.9700, 5.3600, -3.9700)).toBe(0);
  });

  it("calculates Abidjan → Yamoussoukro (~240 km)", () => {
    const d = haversineKm(5.3600, -3.9700, 6.8200, -5.2800);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(300);
  });

  it("calculates Paris → London (~340 km)", () => {
    const d = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(400);
  });
});
