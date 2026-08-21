import { describe, it, expect } from "vitest";
import { haversineKm, toGeoJSONCoordinates } from "../core/geo.js";

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

describe("toGeoJSONCoordinates", () => {
  // MapLibre/GeoJSON exigent [longitude, latitude] — toute inversion
  // envoie le point dans le mauvais hémisphère.
  it("returns [lon, lat] order (Abidjan)", () => {
    expect(toGeoJSONCoordinates(5.36, -3.97)).toEqual([-3.97, 5.36]);
  });

  it("rejects null / non-numeric coordinates", () => {
    expect(toGeoJSONCoordinates(null, -3.97)).toBeNull();
    expect(toGeoJSONCoordinates(5.36, NaN)).toBeNull();
    expect(toGeoJSONCoordinates(undefined, undefined)).toBeNull();
  });

  it("rejects out-of-bounds coordinates (lat>90, lon>180)", () => {
    expect(toGeoJSONCoordinates(91, 0)).toBeNull();
    expect(toGeoJSONCoordinates(0, 181)).toBeNull();
    expect(toGeoJSONCoordinates(-91, 0)).toBeNull();
    expect(toGeoJSONCoordinates(0, -181)).toBeNull();
  });

  it("accepts boundary values", () => {
    expect(toGeoJSONCoordinates(90, 180)).toEqual([180, 90]);
    expect(toGeoJSONCoordinates(-90, -180)).toEqual([-180, -90]);
  });
});
