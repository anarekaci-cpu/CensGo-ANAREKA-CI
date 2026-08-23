import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../core/store.js";
import { canMarkVisited } from "../core/geofence.js";

// Abidjan, Cocody — coordonnées utilisées comme référence dans CONFIG.MAP_CENTER
const POINT_LAT = 5.3724499;
const POINT_LON = -3.9676843;

describe("canMarkVisited (anti-fraude géofence)", () => {
  beforeEach(() => {
    store.set("ui.isAdmin", false);
    store.set("geo.position", null);
  });

  it("refuse quand la position GPS est indisponible", () => {
    expect(canMarkVisited(POINT_LAT, POINT_LON)).toBe(false);
  });

  it("autorise quand l'agent est sur place", () => {
    store.set("geo.position", { lat: POINT_LAT, lng: POINT_LON });
    expect(canMarkVisited(POINT_LAT, POINT_LON)).toBe(true);
  });

  it("autorise dans le rayon de tolérance (~200m)", () => {
    // ~0.0018° de latitude ≈ 200m
    store.set("geo.position", { lat: POINT_LAT + 0.0018, lng: POINT_LON });
    expect(canMarkVisited(POINT_LAT, POINT_LON)).toBe(true);
  });

  it("refuse au-delà du rayon (~5km)", () => {
    store.set("geo.position", { lat: POINT_LAT + 0.045, lng: POINT_LON });
    expect(canMarkVisited(POINT_LAT, POINT_LON)).toBe(false);
  });

  it("laisse toujours passer les admins, même loin", () => {
    store.set("ui.isAdmin", true);
    store.set("geo.position", { lat: POINT_LAT + 0.045, lng: POINT_LON });
    expect(canMarkVisited(POINT_LAT, POINT_LON)).toBe(true);
  });

  it("laisse passer si le point n'a pas de coordonnées valides", () => {
    expect(canMarkVisited(NaN, NaN)).toBe(true);
  });
});
