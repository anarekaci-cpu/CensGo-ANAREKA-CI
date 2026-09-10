import { describe, it, expect } from "vitest";
import {
  pointsToFeatureCollection,
  statusColorExpression,
  boundsFromFeatureCollection
} from "../core/markerGeo.js";
import { CONFIG } from "../core/config.js";

const P = (id, lat, lon, extra = {}) => ({ id, lat, lon, status: "VERT (Joignable)", visited: false, ...extra });

describe("pointsToFeatureCollection", () => {
  it("produit des features [lon, lat] avec les propriétés de style", () => {
    const fc = pointsToFeatureCollection([P(1, 5.36, -3.97, { visited: true })]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.coordinates).toEqual([-3.97, 5.36]);
    expect(fc.features[0].properties).toEqual({
      id: "1", status: "VERT (Joignable)", visited: true, pending: false
    });
  });

  it("normalise l'id en string et marque pending depuis le Set fourni", () => {
    const fc = pointsToFeatureCollection([P(42, 5, -4)], { pendingIds: new Set(["42"]) });
    expect(fc.features[0].properties.id).toBe("42");
    expect(fc.features[0].properties.pending).toBe(true);
  });

  it("accepte pendingIds sous forme de tableau", () => {
    const fc = pointsToFeatureCollection([P("a", 5, -4)], { pendingIds: ["a"] });
    expect(fc.features[0].properties.pending).toBe(true);
  });

  it("ignore les points sans coordonnées fiables (jamais de [0,0] ni d'inversion)", () => {
    const fc = pointsToFeatureCollection([
      P(1, null, null),
      P(2, 91, 0),      // latitude hors bornes
      P(3, 5.36, -3.97) // valide
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.id).toBe("3");
  });

  it("entrée non-tableau -> collection vide", () => {
    expect(pointsToFeatureCollection(null).features).toEqual([]);
  });
});

describe("statusColorExpression", () => {
  it("match sur status, avec repli gris en dernière position", () => {
    const expr = statusColorExpression();
    expect(expr[0]).toBe("match");
    expect(expr[1]).toEqual(["get", "status"]);
    expect(expr[expr.length - 1]).toBe("#95a5a6");
    // chaque couleur de CONFIG.STATUS_COLORS est présente
    for (const color of Object.values(CONFIG.STATUS_COLORS)) {
      expect(expr).toContain(color);
    }
  });
});

describe("boundsFromFeatureCollection", () => {
  it("emprise englobant toutes les features", () => {
    const fc = pointsToFeatureCollection([P(1, 5.30, -4.10), P(2, 5.45, -3.90), P(3, 5.35, -4.00)]);
    expect(boundsFromFeatureCollection(fc)).toEqual([[-4.10, 5.30], [-3.90, 5.45]]);
  });

  it("collection vide -> null", () => {
    expect(boundsFromFeatureCollection({ type: "FeatureCollection", features: [] })).toBeNull();
    expect(boundsFromFeatureCollection(null)).toBeNull();
  });
});
