import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Le module routing.js n'avait AUCUNE couverture de test avant ce diagnostic
 * (seul markerPopup.integration.test.js couvre marker -> popup -> déclenchement
 * de navigation.destination/navigation.active ; le calcul OSRM lui-même
 * n'était jamais exercé). Ces tests verrouillent le contrat HTTP OSRM et les
 * cas d'échec silencieux identifiés dans le diagnostic (coordonnées
 * invalides, HTTP non-OK, code!=="Ok", réseau indisponible).
 */

vi.mock("../modules/map/map.js", () => ({
  addRouteLayer: vi.fn(),
  clearRouteLayers: vi.fn(),
  fitRouteBounds: vi.fn(),
  showDestinationMarker: vi.fn(),
  hideDestinationMarker: vi.fn()
}));

const { calculateRoute, estimateFallbackRoute, formatDistance, formatDuration, NAV_MODES, isValidNavMode } = await import("../modules/routing/routing.js");

describe("calculateRoute", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejette AVANT tout appel réseau si les coordonnées sont invalides (Cas C/E)", async () => {
    await expect(calculateRoute(NaN, -3.97, 5.40, -3.99)).rejects.toThrow("Coordonnées invalides");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejette des coordonnées hors bornes géographiques", async () => {
    await expect(calculateRoute(5.36, -3.97, 200, -3.99)).rejects.toThrow("Coordonnées invalides");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("construit l'URL OSRM en [lng,lat] et interroge le profil piéton", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{
          distance: 500,
          duration: 400,
          geometry: { type: "LineString", coordinates: [[-3.97, 5.36], [-3.99, 5.40]] },
          legs: [{ steps: [] }]
        }]
      })
    });

    await calculateRoute(5.36, -3.97, 5.40, -3.99);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/route/v1/foot/");
    // lng,lat côté OSRM alors que l'appelant passe (lat,lng) -> ordre inversé attendu
    expect(url).toContain("-3.97,5.36;-3.99,5.4");
  });

  it("Cas G : lève une erreur explicite sur HTTP non-OK (au lieu d'échouer silencieusement)", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(calculateRoute(5.36, -3.97, 5.40, -3.99)).rejects.toThrow("HTTP 503");
  });

  it("Cas H : lève une erreur si la réponse OSRM n'a pas code=Ok ou pas de route", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: "NoRoute", routes: [] })
    });
    await expect(calculateRoute(5.36, -3.97, 5.40, -3.99)).rejects.toThrow("Itinéraire impossible");
  });

  it("Cas F : propage l'échec réseau (fetch qui rejette, ex: offline)", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(calculateRoute(5.36, -3.97, 5.40, -3.99)).rejects.toThrow("Failed to fetch");
  });

  it("retourne distance/duration/geometry/steps depuis routes[0]", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{
          distance: 1234.5,
          duration: 678.9,
          geometry: { type: "LineString", coordinates: [[-3.97, 5.36], [-3.99, 5.40]] },
          legs: [{ steps: [{ maneuver: "depart" }] }]
        }]
      })
    });

    const result = await calculateRoute(5.36, -3.97, 5.40, -3.99);
    expect(result.distance).toBe(1234.5);
    expect(result.duration).toBe(678.9);
    expect(result.geometry.coordinates).toHaveLength(2);
    expect(result.steps).toHaveLength(1);
  });

  it("utilise le profil piéton par défaut si aucun mode n'est précisé", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{
          distance: 500,
          duration: 400,
          geometry: { type: "LineString", coordinates: [[-3.97, 5.36], [-3.99, 5.40]] },
          legs: [{ steps: [] }]
        }]
      })
    });
    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99);
    expect(route.mode).toBe("foot");
    expect(route.estimated).toBe(false);
  });

  it("interroge le profil vélo quand mode='bike'", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    await calculateRoute(5.36, -3.97, 5.40, -3.99, "bike");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/bike/");
  });

  it("interroge le profil véhicule quand mode='car'", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/car/");
  });

  it("retombe sur le profil piéton pour un mode inconnu", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    await calculateRoute(5.36, -3.97, 5.40, -3.99, "avion");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/foot/");
  });
});

describe("isValidNavMode / NAV_MODES", () => {
  it("expose les trois modes attendus", () => {
    expect(Object.keys(NAV_MODES).sort()).toEqual(["bike", "car", "foot"]);
  });
  it("valide uniquement les modes connus", () => {
    expect(isValidNavMode("foot")).toBe(true);
    expect(isValidNavMode("bike")).toBe(true);
    expect(isValidNavMode("car")).toBe(true);
    expect(isValidNavMode("avion")).toBe(false);
    expect(isValidNavMode(undefined)).toBe(false);
  });
});

describe("estimateFallbackRoute", () => {
  it("retourne une ligne droite marquée estimated=true", () => {
    const route = estimateFallbackRoute(5.36, -3.97, 5.40, -3.99, "foot");
    expect(route.estimated).toBe(true);
    expect(route.geometry.coordinates).toEqual([[-3.97, 5.36], [-3.99, 5.40]]);
    expect(route.distance).toBeGreaterThan(0);
    expect(route.duration).toBeGreaterThan(0);
  });

  it("une distance identique donne une durée plus courte en véhicule qu'à pied", () => {
    const foot = estimateFallbackRoute(5.36, -3.97, 5.40, -3.99, "foot");
    const car = estimateFallbackRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(car.duration).toBeLessThan(foot.duration);
  });
});

describe("formatDistance / formatDuration", () => {
  it("formats sub-km distances in meters", () => {
    expect(formatDistance(250)).toBe("250 m");
  });
  it("formats km distances with one decimal", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
  });
  it("formats sub-hour durations in minutes", () => {
    expect(formatDuration(600)).toBe("10 min");
  });
  it("formats multi-hour durations as h/min", () => {
    expect(formatDuration(5400)).toBe("1h 30min");
  });
});
