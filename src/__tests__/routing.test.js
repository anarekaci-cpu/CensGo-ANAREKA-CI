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

const { calculateRoute, estimateFallbackRoute, formatDistance, formatDuration, NAV_MODES, isValidNavMode, findNearestByRoad, formatManeuverInstruction, getManeuverIcon } = await import("../modules/routing/routing.js");

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

  it("retourne distance/geometry/steps depuis routes[0] (distance ROUTÉE conservée telle quelle)", async () => {
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

  it("interroge TOUJOURS le profil piéton réel du serveur, même pour mode='bike'/'car' (le serveur OSRM du projet n'expose qu'un seul profil)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    await calculateRoute(5.36, -3.97, 5.40, -3.99, "bike");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/foot/");
    globalThis.fetch.mockClear();
    await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/foot/");
  });

  it("mode='bike'/'car' : distance réelle OSRM conservée, mais durée recalculée à la vitesse du mode (pas le temps de marche renvoyé par le serveur)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        // distance réelle 4200m, duration=3000s (temps de MARCHE renvoyé par
        // le profil foot du serveur) — ne doit PAS être réutilisé tel quel
        // pour un trajet en vélo ou en véhicule.
        routes: [{ distance: 4200, duration: 3000, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    const bike = await calculateRoute(5.36, -3.97, 5.40, -3.99, "bike");
    expect(bike.distance).toBe(4200);
    expect(bike.mode).toBe("bike");
    expect(bike.duration).not.toBe(3000);
    expect(bike.duration).toBeCloseTo(4200 / 4.2, 0);

    const car = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(car.duration).toBeCloseTo(4200 / 11.1, 0);
    expect(car.duration).toBeLessThan(bike.duration);
  });

  it("mode='foot' (ou absent) : la durée n'est JAMAIS celle renvoyée par OSRM, même pour ce profil (bug confirmé en production : ~46 km/h)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        // duration=999s renvoyé par le serveur pour le profil "foot" — une
        // valeur clairement différente de distance/vitesse-piéton, pour
        // prouver qu'elle n'est PAS réutilisée telle quelle.
        routes: [{ distance: 4200, duration: 999, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "foot");
    expect(route.duration).not.toBe(999);
    expect(route.duration).toBeCloseTo(4200 / 1.4, 0);
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
    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "avion");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/foot/");
    expect(route.mode).toBe("foot");
  });
});

describe("findNearestByRoad", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Cas réel signalé : un point A est plus proche À VOL D'OISEAU qu'un
  // point B, mais B est en réalité plus proche PAR LA ROUTE (A de l'autre
  // côté d'une lagune, détour par un pont). findNearestByRoad() doit
  // classer B devant A, contrairement à un simple tri haversine.
  it("choisit le candidat le plus proche PAR LA ROUTE, pas à vol d'oiseau", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        // distances[0] : source -> [candidat A, candidat B], DANS L'ORDRE
        // donné à findNearestByRoad(). A = 300m à vol d'oiseau mais 4000m
        // par la route (détour) ; B = 800m à vol d'oiseau mais 850m par la
        // route (direct) — B doit gagner.
        distances: [[4000, 850]]
      })
    });

    const candidates = [
      { lat: 5.361, lon: -3.968 }, // A
      { lat: 5.375, lon: -3.965 }  // B
    ];
    const result = await findNearestByRoad(5.36, -3.97, candidates);

    expect(result.index).toBe(1); // B, pas A
    expect(result.distanceM).toBe(850);
  });

  it("construit l'URL /table avec sources=0 et une destination par candidat", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: "Ok", distances: [[100, 200]] })
    });
    await findNearestByRoad(5.36, -3.97, [{ lat: 5.37, lon: -3.98 }, { lat: 5.38, lon: -3.99 }]);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/table/v1/foot/");
    expect(url).toContain("sources=0");
    expect(url).toContain("destinations=1;2");
  });

  it("ignore une destination inatteignable (null) plutôt que de planter", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: "Ok", distances: [[null, 600]] })
    });
    const result = await findNearestByRoad(5.36, -3.97, [{ lat: 5.37, lon: -3.98 }, { lat: 5.38, lon: -3.99 }]);
    expect(result.index).toBe(1);
    expect(result.distanceM).toBe(600);
  });

  it("retourne null (pas d'exception) si la requête réseau échoue — repli attendu côté appelant", async () => {
    globalThis.fetch.mockRejectedValue(new Error("network down"));
    const result = await findNearestByRoad(5.36, -3.97, [{ lat: 5.37, lon: -3.98 }]);
    expect(result).toBeNull();
  });

  it("retourne null sans appel réseau si la liste de candidats est vide", async () => {
    const result = await findNearestByRoad(5.36, -3.97, []);
    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
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

// Guidage gauche/droite/tout droit/demi-tour : la classification vient
// TOUJOURS du maneuver.modifier réel renvoyé par OSRM (steps), jamais d'une
// déduction latitude/longitude — voir le commentaire de getManeuverIcon().
describe("formatManeuverInstruction / getManeuverIcon — guidage directionnel", () => {
  it("virage à droite", () => {
    const step = { maneuver: { type: "turn", modifier: "right" }, name: "Rue du Commerce" };
    expect(getManeuverIcon(step)).toBe("↱");
    expect(formatManeuverInstruction(step)).toBe("↱ Tournez à droite sur Rue du Commerce");
  });

  it("virage à gauche", () => {
    const step = { maneuver: { type: "turn", modifier: "left" }, name: "Boulevard Latrille" };
    expect(getManeuverIcon(step)).toBe("↰");
    expect(formatManeuverInstruction(step)).toBe("↰ Tournez à gauche sur Boulevard Latrille");
  });

  it("tout droit", () => {
    const step = { maneuver: { type: "continue", modifier: "straight" } };
    expect(getManeuverIcon(step)).toBe("⬆️");
    expect(formatManeuverInstruction(step)).toBe("⬆️ Continuez tout droit");
  });

  it("demi-tour", () => {
    const step = { maneuver: { type: "turn", modifier: "uturn" } };
    expect(getManeuverIcon(step)).toBe("↩️");
    expect(formatManeuverInstruction(step)).toBe("↩️ Faites demi-tour");
  });

  it("arrivée et départ ont leurs propres icônes", () => {
    expect(getManeuverIcon({ maneuver: { type: "arrive" } })).toBe("🏁");
    expect(getManeuverIcon({ maneuver: { type: "depart" } })).toBe("🚦");
  });

  it("step invalide -> chaîne/icône neutres, jamais d'exception", () => {
    expect(formatManeuverInstruction(null)).toBe("");
    expect(formatManeuverInstruction({})).toBe("");
    expect(getManeuverIcon(null)).toBe("⬆️");
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
