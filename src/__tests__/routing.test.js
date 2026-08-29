import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CONFIG } from "../core/config.js";

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

const { calculateRoute, estimateFallbackRoute, formatDistance, formatDuration, NAV_MODES, isValidNavMode, findNearestByRoad } = await import("../modules/routing/routing.js");

describe("calculateRoute", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    // Heure fixe HORS heure de pointe (voir trafficHeuristic.js, 7h-9h/17h-19h) :
    // sans ça, la durée voiture calculée dépendrait de l'heure d'exécution des
    // tests et les assertions ci-dessous deviendraient aléatoirement flaky.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-10T12:00:00"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
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

describe("findNearestByRoad — priorité ORS quand une clé est configurée", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = CONFIG.ORS_API_KEY;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    CONFIG.ORS_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    CONFIG.ORS_API_KEY = originalKey;
  });

  it("interroge le Matrix API ORS plutôt qu'OSRM quand une clé est présente", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ distances: [[500, 200]] })
    });

    const result = await findNearestByRoad(5.36, -3.97, [
      { lat: 5.37, lon: -3.98 },
      { lat: 5.38, lon: -3.99 }
    ]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/v2/matrix/foot-walking");
    expect(options.headers.Authorization).toBe("test-key");
    const body = JSON.parse(options.body);
    expect(body.sources).toEqual([0]);
    expect(body.destinations).toEqual([1, 2]);
    expect(result).toEqual({ index: 1, distanceM: 200 });
  });

  it("retombe sur OSRM si l'appel ORS échoue (jamais d'erreur remontée)", async () => {
    globalThis.fetch
      .mockRejectedValueOnce(new Error("quota dépassé")) // ORS
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: "Ok", distances: [[300]] }) }); // OSRM

    const result = await findNearestByRoad(5.36, -3.97, [{ lat: 5.37, lon: -3.98 }]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][0]).toContain("/table/v1/foot/");
    expect(result).toEqual({ index: 0, distanceM: 300 });
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-10T12:00:00")); // hors heure de pointe
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

function orsResponse({ distance = 5000, duration = 600 } = {}) {
  return {
    features: [{
      geometry: { type: "LineString", coordinates: [[-3.97, 5.36], [-3.98, 5.38], [-3.99, 5.40]] },
      properties: {
        summary: { distance, duration },
        segments: [{
          steps: [
            { instruction: "Tournez à droite sur Rue X", name: "Rue X", way_points: [0, 1] },
            { instruction: "🏁 Vous êtes arrivé à destination", name: "", way_points: [2, 2] }
          ]
        }]
      }
    }]
  };
}

describe("calculateRoute — OpenRouteService (Priorité 1 roadmap)", () => {
  const originalFetch = globalThis.fetch;
  const originalOrsKey = CONFIG.ORS_API_KEY;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    CONFIG.ORS_API_KEY = "test-ors-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-10T12:00:00")); // hors heure de pointe
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    CONFIG.ORS_API_KEY = originalOrsKey;
    vi.useRealTimers();
  });

  it("interroge le profil ORS exact du mode demandé avec POST et les alternatives", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => orsResponse() });

    await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/v2/directions/driving-car/geojson");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.coordinates).toEqual([[-3.97, 5.36], [-3.99, 5.4]]);
    expect(body.alternative_routes).toEqual({ target_count: 3, share_factor: 0.6 });
    expect(opts.headers.Authorization).toBe("test-ors-key");
  });

  it("retourne distance/durée/géométrie ORS et provider='ors', sans appeler OSRM", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => orsResponse({ distance: 5000, duration: 600 }) });

    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "bike");
    expect(route.distance).toBe(5000);
    expect(route.duration).toBe(600); // heure creuse, vélo non affecté par le trafic
    expect(route.provider).toBe("ors");
    expect(route.estimated).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("les steps ORS portent maneuver.location (compatible guidage pas-à-pas navigation.js)", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => orsResponse() });

    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "foot");
    expect(route.steps[0].maneuver.location).toEqual([-3.97, 5.36]);
    expect(route.steps[1].maneuver.location).toEqual([-3.99, 5.40]);
  });

  it("applique le ralentissement heure de pointe à la durée ORS, mode voiture uniquement", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => orsResponse({ distance: 5000, duration: 600 }) });

    vi.setSystemTime(new Date("2024-06-10T08:00:00")); // heure de pointe
    const car = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(car.duration).toBeGreaterThan(600);

    globalThis.fetch.mockClear();
    const foot = await calculateRoute(5.36, -3.97, 5.40, -3.99, "foot");
    expect(foot.duration).toBe(600);
  });

  it("sélectionne le plus rapide ajusté et expose le plus court séparément", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({
      features: [
        orsResponse({ distance: 3000, duration: 500 }).features[0],
        orsResponse({ distance: 5000, duration: 300 }).features[0],
        orsResponse({ distance: 4200, duration: 250 }).features[0]
      ]
    }) });
    vi.setSystemTime(new Date("2024-06-10T08:00:00"));
    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(route.provider).toBe("ors");
    expect(route.shortest.distance).toBe(3000);
    expect(route.suggested.distance).toBe(4200);
    expect(route.alternatives).toHaveLength(3);
    expect(route.selection).toBe("suggested");
  });

  it("retombe sur OSRM si ORS répond en erreur HTTP", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: false, status: 429 }) // ORS : quota dépassé
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
        })
      });

    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][0]).toContain("/route/v1/foot/");
    expect(route.provider).toBeUndefined(); // route OSRM, pas ORS
  });

  it("retombe sur OSRM si ORS échoue au niveau réseau (offline/timeout)", async () => {
    globalThis.fetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
        })
      });

    const route = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(route.distance).toBe(100);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("ne tente jamais ORS si aucune clé n'est configurée (repli direct sur OSRM)", async () => {
    CONFIG.ORS_API_KEY = "";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 100, duration: 50, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });

    await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/route/v1/foot/");
  });
});

describe("formatManeuverInstruction", () => {
  it("utilise directement step.instruction quand présent (steps ORS, déjà en français)", async () => {
    const { formatManeuverInstruction } = await import("../modules/routing/routing.js");
    expect(formatManeuverInstruction({ instruction: "Tournez à droite sur Rue X" })).toBe("Tournez à droite sur Rue X");
  });

  it("retombe sur la reconstruction type/modifier pour les steps OSRM (pas d'instruction)", async () => {
    const { formatManeuverInstruction } = await import("../modules/routing/routing.js");
    expect(formatManeuverInstruction({ maneuver: { type: "depart" }, name: "Rue X" })).toBe("🚦 Départ sur Rue X");
  });

  it("retourne une chaîne vide pour un step vide", async () => {
    const { formatManeuverInstruction } = await import("../modules/routing/routing.js");
    expect(formatManeuverInstruction(null)).toBe("");
    expect(formatManeuverInstruction({})).toBe("");
  });
});

describe("calculateRoute / estimateFallbackRoute — trafic heuristique (mode voiture)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 4200, duration: 999, geometry: { type: "LineString", coordinates: [] }, legs: [{ steps: [] }] }]
      })
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("calculateRoute : durée voiture plus longue à l'heure de pointe (8h) qu'en heure creuse (12h), à distance identique", async () => {
    vi.setSystemTime(new Date("2024-06-10T12:00:00"));
    const offPeak = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");

    vi.setSystemTime(new Date("2024-06-10T08:00:00"));
    const rushHour = await calculateRoute(5.36, -3.97, 5.40, -3.99, "car");

    expect(rushHour.duration).toBeGreaterThan(offPeak.duration);
  });

  it("calculateRoute : le mode piéton n'est pas affecté par l'heure de pointe", async () => {
    vi.setSystemTime(new Date("2024-06-10T12:00:00"));
    const offPeak = await calculateRoute(5.36, -3.97, 5.40, -3.99, "foot");

    vi.setSystemTime(new Date("2024-06-10T08:00:00"));
    const rushHour = await calculateRoute(5.36, -3.97, 5.40, -3.99, "foot");

    expect(rushHour.duration).toBeCloseTo(offPeak.duration, 6);
  });

  it("estimateFallbackRoute : même comportement hors-ligne (mode voiture ralenti aux heures de pointe)", () => {
    vi.setSystemTime(new Date("2024-06-10T18:00:00")); // heure de pointe du soir
    const rushHour = estimateFallbackRoute(5.36, -3.97, 5.40, -3.99, "car");
    vi.setSystemTime(new Date("2024-06-10T22:00:00")); // heure creuse
    const offPeak = estimateFallbackRoute(5.36, -3.97, 5.40, -3.99, "car");

    expect(rushHour.duration).toBeGreaterThan(offPeak.duration);
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
