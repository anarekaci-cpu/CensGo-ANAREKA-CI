import { describe, it, expect, vi, beforeEach } from "vitest";
import { store } from "../core/store.js";

const routingMocks = vi.hoisted(() => ({
  calculateRoute: vi.fn(),
  estimateFallbackRoute: vi.fn(),
  displayRoute: vi.fn(),
  clearRoute: vi.fn()
}));

vi.mock("../modules/map/map.js", () => ({
  flyToPoint: vi.fn(),
  enableCameraFollow: vi.fn(),
  getMap: vi.fn(() => null)
}));

vi.mock("../modules/census/markers.js", () => ({
  refreshMarker: vi.fn(),
  openPopup: vi.fn()
}));

vi.mock("../modules/routing/routing.js", () => ({
  calculateRoute: routingMocks.calculateRoute,
  estimateFallbackRoute: routingMocks.estimateFallbackRoute,
  displayRoute: routingMocks.displayRoute,
  clearRoute: routingMocks.clearRoute,
  formatDuration: () => "",
  formatDistance: () => "",
  formatManeuverInstruction: () => "",
  showRouteDestination: vi.fn(),
  refreshLearnedWalkingSpeed: vi.fn()
}));

vi.mock("../core/speech.js", () => ({
  speak: vi.fn(),
  cancelSpeech: vi.fn()
}));

const { initNavigation } = await import("../modules/navigation/navigation.js");

// Cocody, Abidjan — même zone de référence que geofence.test.js.
const START_LAT = 5.3724499;
const START_LON = -3.9676843;
// Destination proche (route quasi rectiligne) pour un test simple.
const DEST_LAT = 5.3734499;
const DEST_LON = -3.9686843;
const REROUTE_DEBOUNCE_MS = 15000;

function buildRoute() {
  return {
    distance: 1200,
    duration: 900,
    mode: "foot",
    steps: [],
    geometry: { coordinates: [[START_LON, START_LAT], [DEST_LON, DEST_LAT]] }
  };
}

describe("navigation — recalcul d'itinéraire malgré une précision GPS dégradée", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routingMocks.calculateRoute.mockReset();
    routingMocks.calculateRoute.mockResolvedValue(buildRoute());
    routingMocks.estimateFallbackRoute.mockReset();
    routingMocks.displayRoute.mockReset();
    routingMocks.clearRoute.mockReset();
    store.set("navigation.active", false);
    store.set("navigation.destination", null);
    store.set("navigation.route", null);
    store.set("geo.position", null);
  });

  it("relance calculateRoute sur un écart de tracé massif même avec accuracy > 100m", async () => {
    initNavigation();

    store.set("geo.position", { lat: START_LAT, lng: START_LON, accuracy: 10 });
    store.set("navigation.destination", { lat: DEST_LAT, lon: DEST_LON, name: "Test" });
    await vi.advanceTimersByTimeAsync(50);

    store.set("navigation.active", true);
    await vi.advanceTimersByTimeAsync(100);

    expect(routingMocks.calculateRoute).toHaveBeenCalledTimes(1);
    expect(store.get("navigation.route")).toBeTruthy();

    // Purge le anti-spam de recalcul (15s) pour isoler le comportement testé.
    await vi.advanceTimersByTimeAsync(REROUTE_DEBOUNCE_MS + 100);

    // Fix très imprécis (bien au-delà de MAX_TRUSTED_ACCURACY_M=100) ET à
    // des kilomètres du tracé affiché — seul un vrai déplacement peut
    // l'expliquer, jamais du seul bruit GPS.
    store.set("geo.position", {
      lat: START_LAT + 0.05, // ≈ 5.5km plus au nord, hors de tout tracé plausible
      lng: START_LON,
      accuracy: 500
    });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    // BUG corrigé : sans le correctif, cette assertion échouait à 1 —
    // maybeReroute() était bloqué par la même garde isPositionTrustworthy()
    // que le reste du guidage, donc le tracé restait figé malgré un
    // déplacement réel massif.
    expect(routingMocks.calculateRoute).toHaveBeenCalledTimes(2);
  });
});

describe("navigation — aucun itinéraire trouvé (ORS et OSRM épuisés)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    routingMocks.calculateRoute.mockReset();
    routingMocks.calculateRoute.mockRejectedValue(new Error("Itinéraire impossible"));
    routingMocks.estimateFallbackRoute.mockReset();
    routingMocks.estimateFallbackRoute.mockReturnValue({
      distance: 5000,
      duration: 3600,
      mode: "foot",
      steps: [],
      geometry: { coordinates: [[START_LON, START_LAT], [DEST_LON, DEST_LAT]] },
      estimated: true
    });
    routingMocks.displayRoute.mockReset();
    routingMocks.clearRoute.mockReset();
    store.set("navigation.active", false);
    store.set("navigation.destination", null);
    store.set("navigation.route", null);
    store.set("geo.position", null);
  });

  it("EN LIGNE : ne dessine pas de ligne droite — affiche 'aucun itinéraire trouvé'", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    initNavigation();

    store.set("geo.position", { lat: START_LAT, lng: START_LON, accuracy: 10 });
    store.set("navigation.destination", { lat: DEST_LAT, lon: DEST_LON, name: "Test" });
    await vi.advanceTimersByTimeAsync(50);

    store.set("navigation.active", true);
    await vi.advanceTimersByTimeAsync(100);

    // BUG signalé : avant le correctif, ce cas dessinait quand même une
    // ligne droite (estimateFallbackRoute) traversant l'eau/les bâtiments,
    // comme si c'était un vrai tracé, alors qu'un routeur joignable a
    // explicitement répondu "pas d'itinéraire".
    expect(routingMocks.estimateFallbackRoute).not.toHaveBeenCalled();
    expect(routingMocks.displayRoute).not.toHaveBeenCalled();
    expect(routingMocks.clearRoute).toHaveBeenCalled();
    expect(store.get("navigation.instruction")).toMatch(/Aucun itinéraire trouvé/);
  });

  it("HORS-LIGNE : garde l'estimation à vol d'oiseau en dernier recours", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    initNavigation();

    store.set("geo.position", { lat: START_LAT, lng: START_LON, accuracy: 10 });
    store.set("navigation.destination", { lat: DEST_LAT, lon: DEST_LON, name: "Test" });
    await vi.advanceTimersByTimeAsync(50);

    store.set("navigation.active", true);
    await vi.advanceTimersByTimeAsync(100);

    expect(routingMocks.estimateFallbackRoute).toHaveBeenCalled();
    expect(routingMocks.displayRoute).toHaveBeenCalled();
    expect(store.get("navigation.route")?.estimated).toBe(true);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
});
