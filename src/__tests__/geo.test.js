import { describe, it, expect } from "vitest";
import { haversineKm, toGeoJSONCoordinates, bearingDeg, cardinalLabel } from "../core/geo.js";

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

describe("bearingDeg", () => {
  it("un point plein Nord donne un cap de 0°", () => {
    const b = bearingDeg(5.36, -3.97, 5.40, -3.97);
    expect(b).toBeCloseTo(0, 0);
  });

  it("un point plein Est (même latitude) donne un cap proche de 90°", () => {
    const b = bearingDeg(5.36, -3.97, 5.36, -3.90);
    expect(b).toBeGreaterThan(85);
    expect(b).toBeLessThan(95);
  });

  it("un point plein Sud donne un cap de 180°", () => {
    const b = bearingDeg(5.36, -3.97, 5.30, -3.97);
    expect(b).toBeCloseTo(180, 0);
  });

  it("reste toujours dans [0, 360)", () => {
    const b = bearingDeg(5.36, -3.97, 5.36, -4.10); // plein Ouest
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    expect(b).toBeGreaterThan(265);
    expect(b).toBeLessThan(275);
  });
});

describe("cardinalLabel", () => {
  it("mappe les 8 directions cardinales", () => {
    expect(cardinalLabel(0)).toBe("Nord");
    expect(cardinalLabel(45)).toBe("Nord-Est");
    expect(cardinalLabel(90)).toBe("Est");
    expect(cardinalLabel(135)).toBe("Sud-Est");
    expect(cardinalLabel(180)).toBe("Sud");
    expect(cardinalLabel(225)).toBe("Sud-Ouest");
    expect(cardinalLabel(270)).toBe("Ouest");
    expect(cardinalLabel(315)).toBe("Nord-Ouest");
  });

  it("boucle correctement près de 360°", () => {
    expect(cardinalLabel(359)).toBe("Nord");
    expect(cardinalLabel(361)).toBe("Nord");
  });

  it("retourne une chaîne vide pour une valeur non numérique", () => {
    expect(cardinalLabel(NaN)).toBe("");
    expect(cardinalLabel(undefined)).toBe("");
  });
});
