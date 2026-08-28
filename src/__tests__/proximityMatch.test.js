import { describe, it, expect } from "vitest";
import { findProximityMatches } from "../modules/census/proximityMatch.js";

// Abidjan, Cocody — même référence que geofence.test.js.
const LAT = 5.3724499;
const LON = -3.9676843;

function makePoint(id, overrides = {}) {
  return { id, lat: LAT, lon: LON, name: "Chez Tantie Aya", tel: "0708091011", ...overrides };
}

describe("findProximityMatches", () => {
  it("classe un point à la même position en doublon strict", () => {
    const points = [makePoint("p1")];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON });
    expect(strict.map(p => p.id)).toEqual(["p1"]);
    expect(fuzzy).toEqual([]);
  });

  it("exclut le point en cours d'édition (excludeId)", () => {
    const points = [makePoint("p1")];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON, excludeId: "p1" });
    expect(strict).toEqual([]);
    expect(fuzzy).toEqual([]);
  });

  it("ignore les points sans coordonnées", () => {
    const points = [makePoint("p1", { lat: null, lon: null })];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON });
    expect(strict).toEqual([]);
    expect(fuzzy).toEqual([]);
  });

  it("détecte un doublon flou par téléphone identique dans le rayon élargi", () => {
    // ~0.001° ≈ 111m — hors rayon strict (25m) mais dans le rayon flou (150m).
    const points = [makePoint("p1", { lat: LAT + 0.001, name: "Nom Totalement Différent" })];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON, tel: "07 08 09 10 11" });
    expect(strict).toEqual([]);
    expect(fuzzy.map(p => p.id)).toEqual(["p1"]);
  });

  it("détecte un doublon flou par nom proche (variante d'orthographe)", () => {
    const points = [makePoint("p1", { lat: LAT + 0.001, tel: "0100000000", name: "Chez Tantie Aya" })];
    const { fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON, name: "Chez Tanti Aya" });
    expect(fuzzy.map(p => p.id)).toEqual(["p1"]);
  });

  it("ne signale pas de doublon flou sans nom ni téléphone fournis", () => {
    const points = [makePoint("p1", { lat: LAT + 0.001 })];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON });
    expect(strict).toEqual([]);
    expect(fuzzy).toEqual([]);
  });

  it("ne compte pas deux fois un point déjà strict dans les résultats flous", () => {
    const points = [makePoint("p1")];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON, name: "Chez Tantie Aya", tel: "0708091011" });
    expect(strict.map(p => p.id)).toEqual(["p1"]);
    expect(fuzzy).toEqual([]);
  });

  it("ignore les points hors du rayon flou", () => {
    // ~0.05° ≈ 5.5km, largement hors des 150m.
    const points = [makePoint("p1", { lat: LAT + 0.05 })];
    const { strict, fuzzy } = findProximityMatches(points, { lat: LAT, lon: LON, name: "Chez Tantie Aya", tel: "0708091011" });
    expect(strict).toEqual([]);
    expect(fuzzy).toEqual([]);
  });
});
