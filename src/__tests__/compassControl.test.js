import { describe, it, expect, vi } from "vitest";

// map.js importe maplibre-gl (+ CSS) et @versatiles/style au chargement du
// module — on les neutralise pour tester la seule fonction pure.
vi.mock("maplibre-gl", () => ({ default: {}, setWorkerUrl: () => {}, Map: class {}, NavigationControl: class {}, AttributionControl: class {}, ScaleControl: class {}, Marker: class {}, Popup: class {}, LngLatBounds: class {} }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "worker.js" }));
vi.mock("@versatiles/style", () => ({ shadow: () => ({}) }));

const { compassNeedleTransform, pickBuildingSourceId } = await import("../modules/map/map.js");

describe("compassNeedleTransform", () => {
  it("cap 0 -> aiguille à 0°", () => {
    expect(compassNeedleTransform(0)).toBe("rotate(0.0deg)");
  });

  it("tourne à l'inverse du cap de la carte (le nord reste pointé)", () => {
    expect(compassNeedleTransform(90)).toBe("rotate(-90.0deg)");
    expect(compassNeedleTransform(45.5)).toBe("rotate(-45.5deg)");
  });

  it("normalise les caps hors [0,360)", () => {
    expect(compassNeedleTransform(360)).toBe("rotate(0.0deg)");
    expect(compassNeedleTransform(450)).toBe("rotate(-90.0deg)");
    expect(compassNeedleTransform(-90)).toBe("rotate(-270.0deg)");
  });

  it("entrée non numérique -> 0°", () => {
    expect(compassNeedleTransform(undefined)).toBe("rotate(0.0deg)");
    expect(compassNeedleTransform(NaN)).toBe("rotate(0.0deg)");
  });
});

describe("pickBuildingSourceId", () => {
  it("prend la source d'une couche 'building' déjà déclarée", () => {
    const style = {
      sources: { openmaptiles: { type: "vector" }, sat: { type: "raster" } },
      layers: [
        { id: "water", source: "openmaptiles", "source-layer": "water" },
        { id: "building", source: "openmaptiles", "source-layer": "building" }
      ]
    };
    expect(pickBuildingSourceId(style)).toBe("openmaptiles");
  });

  it("repli sur la première source vecteur si aucune couche building", () => {
    const style = {
      sources: { basemap: { type: "vector" }, sat: { type: "raster" } },
      layers: [{ id: "roads", source: "basemap", "source-layer": "transportation" }]
    };
    expect(pickBuildingSourceId(style)).toBe("basemap");
  });

  it("null si aucune source vecteur", () => {
    expect(pickBuildingSourceId({ sources: { sat: { type: "raster" } }, layers: [] })).toBeNull();
    expect(pickBuildingSourceId(null)).toBeNull();
  });
});
