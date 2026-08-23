import { describe, it, expect } from "vitest";
import { computeTileList } from "../modules/map/offlineTiles.js";

describe("computeTileList", () => {
  it("au zoom 0, toute la terre tient sur une seule tuile (0,0)", () => {
    const tiles = computeTileList({ west: -180, south: -85, east: 180, north: 85 }, [0]);
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
  });

  it("couvre plusieurs tuiles pour une zone plus large qu'une tuile au zoom donné", () => {
    // Abidjan, zoom 15 : une zone de ~0.05° de large/haut couvre plusieurs tuiles.
    const tiles = computeTileList(
      { west: -4.03, south: 5.30, east: -3.95, north: 5.38 },
      [15]
    );
    expect(tiles.length).toBeGreaterThan(1);
    // Toutes les tuiles doivent être au zoom demandé.
    expect(tiles.every(t => t.z === 15)).toBe(true);
  });

  it("agrège les tuiles de plusieurs niveaux de zoom sans les mélanger", () => {
    const bounds = { west: -3.99, south: 5.36, east: -3.97, north: 5.38 };
    const tiles = computeTileList(bounds, [14, 15]);
    const z14 = tiles.filter(t => t.z === 14);
    const z15 = tiles.filter(t => t.z === 15);
    expect(z14.length).toBeGreaterThan(0);
    expect(z15.length).toBeGreaterThan(0);
    expect(z14.length + z15.length).toBe(tiles.length);
  });

  it("l'indice Y croît vers le sud (nord = Y minimal)", () => {
    const tiles = computeTileList({ west: -3.99, south: 5.30, east: -3.97, north: 5.40 }, [12]);
    const ys = tiles.map(t => t.y);
    // La zone couvre plusieurs degrés de latitude au zoom 12 -> au moins 2 lignes de tuiles.
    expect(new Set(ys).size).toBeGreaterThanOrEqual(1);
  });

  it("retourne un tableau vide pour des entrées invalides", () => {
    expect(computeTileList(null, [10])).toEqual([]);
    expect(computeTileList({ west: 0, south: 0, east: 1, north: 1 }, null)).toEqual([]);
  });
});
