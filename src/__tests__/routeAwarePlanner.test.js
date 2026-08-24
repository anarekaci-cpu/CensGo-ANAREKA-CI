import { describe, it, expect } from "vitest";
import {
  buildRouteContext,
  projectPointOnRoute,
  classifyRouteCandidate,
  orderRouteCandidates,
  corridorMetersForMode,
  planRouteAwareTour
} from "../core/routeAwarePlanner.js";

const mkPoint = (id, lat, lon, visited = false) => ({ id, lat, lon, visited });

// Segment N-S de ~111.19m par 0.001° de latitude à cette latitude — sert
// de route de référence pour buildRouteContext/projectPointOnRoute.
const straightNorthRoute = buildRouteContext([
  [-3.990, 5.350],
  [-3.990, 5.351],
  [-3.990, 5.352]
]);

describe("buildRouteContext", () => {
  it("calcule la longueur totale comme somme des segments (haversine)", () => {
    expect(straightNorthRoute.totalLengthM).toBeCloseTo(222.4, 0);
    expect(straightNorthRoute.segLengthsM).toHaveLength(2);
    expect(straightNorthRoute.segLengthsM[0]).toBeCloseTo(111.2, 0);
  });

  it("polyligne vide/absente -> contexte à longueur nulle, sans exception", () => {
    expect(buildRouteContext([]).totalLengthM).toBe(0);
    expect(buildRouteContext(undefined).totalLengthM).toBe(0);
  });
});

describe("projectPointOnRoute", () => {
  it("un point exactement sur la route a une distance ~0 et la progression attendue", () => {
    const proj = projectPointOnRoute({ lat: 5.3505, lon: -3.990 }, straightNorthRoute);
    expect(proj.distanceToRouteM).toBeLessThan(1);
    expect(proj.progressM).toBeCloseTo(55.6, 0);
  });

  it("un point décalé latéralement a une distance perpendiculaire non nulle", () => {
    // ~0.0005° de longitude à cette latitude ≈ 55m à l'est de la route.
    const proj = projectPointOnRoute({ lat: 5.3505, lon: -3.9895 }, straightNorthRoute);
    expect(proj.distanceToRouteM).toBeGreaterThan(40);
    expect(proj.distanceToRouteM).toBeLessThan(70);
  });

  it("coordonnées invalides -> distance infinie, jamais d'exception", () => {
    const proj = projectPointOnRoute({ lat: NaN, lon: -3.990 }, straightNorthRoute);
    expect(proj.distanceToRouteM).toBe(Infinity);
  });
});

describe("classifyRouteCandidate", () => {
  it("dans le corridor et devant la position -> ON_ROUTE", () => {
    expect(classifyRouteCandidate({ distanceToRouteM: 20, progressM: 100 }, 35)).toBe("ON_ROUTE");
  });

  it("hors du corridor -> OFF_CORRIDOR", () => {
    expect(classifyRouteCandidate({ distanceToRouteM: 50, progressM: 100 }, 35)).toBe("OFF_CORRIDOR");
  });

  it("progression quasi nulle (déjà dépassé / confondu avec le départ) -> BEHIND", () => {
    expect(classifyRouteCandidate({ distanceToRouteM: 5, progressM: 2 }, 35)).toBe("BEHIND");
  });

  it("projection invalide -> OFF_CORRIDOR (jamais d'exception)", () => {
    expect(classifyRouteCandidate({ distanceToRouteM: NaN, progressM: NaN }, 35)).toBe("OFF_CORRIDOR");
  });
});

describe("orderRouteCandidates", () => {
  it("trie par progression croissante sans muter l'entrée", () => {
    const input = [{ id: "c", progressM: 300 }, { id: "a", progressM: 50 }, { id: "b", progressM: 150 }];
    const sorted = orderRouteCandidates(input);
    expect(sorted.map(c => c.id)).toEqual(["a", "b", "c"]);
    expect(input.map(c => c.id)).toEqual(["c", "a", "b"]);
  });
});

describe("corridorMetersForMode", () => {
  it("expose des largeurs de corridor modestes et croissantes piéton < vélo < véhicule", () => {
    const foot = corridorMetersForMode("foot");
    const bike = corridorMetersForMode("bike");
    const car = corridorMetersForMode("car");
    expect(foot).toBeLessThan(bike);
    expect(bike).toBeLessThan(car);
    expect(car).toBeLessThan(200); // jamais une valeur énorme (cahier des charges, point 9)
  });
});

// Mock générique : géométrie en ligne droite entre l'origine et la
// destination demandées — suffisant pour tester la mécanique de
// l'orchestrateur sans dépendre d'un vrai réseau routier.
const straightLineFetchRoute = async (fromLat, fromLng, toLat, toLng) => ({
  geometry: { coordinates: [[fromLng, fromLat], [toLng, toLat]] }
});

describe("planRouteAwareTour", () => {
  const start = { lat: 5.350, lng: -3.990 };

  it("liste vide -> tournée vide, sans appel réseau", async () => {
    const { sequence } = await planRouteAwareTour([], start, { fetchRoute: straightLineFetchRoute });
    expect(sequence).toEqual([]);
  });

  // Cas réel signalé (capture d'écran) : un point plus proche à vol
  // d'oiseau peut exiger un détour réel (lagune/pont, obstacle) alors
  // qu'un point plus loin à vol d'oiseau est en fait directement
  // accessible. Le choix d'ANCRE de chaque lot doit se faire sur la
  // distance ROUTÉE réelle, pas seulement la présélection à vol d'oiseau
  // — sinon le même bug que "plus proche" (déjà corrigé pour ce bouton
  // précis) resurgirait ici, au niveau de la tournée complète.
  it("choisit l'ancre du lot par distance ROUTÉE réelle, pas à vol d'oiseau (cas lagune)", async () => {
    const near = mkPoint("near_but_detour", 5.3504, -3.990); // ~44m à vol d'oiseau
    const far = mkPoint("far_but_direct", 5.3520, -3.990);   // ~222m à vol d'oiseau, mais routier direct

    const fetchRoadDistances = async (fromLat, fromLng, candidates) =>
      candidates.map(c => (c.id === "near_but_detour" ? 4000 : 210));

    const { sequence } = await planRouteAwareTour([near, far], start, {
      fetchRoute: straightLineFetchRoute,
      fetchRoadDistances
    });

    expect(sequence[0].id).toBe("far_but_direct");
    // "near" reste malgré tout dans la tournée (visité ensuite), jamais perdu.
    expect(sequence.map(p => p.id)).toContain("near_but_detour");
  });

  // Reproduit très directement l'exemple du cahier des charges (point 4) :
  // P1..P4 alignés entre l'agent et P5 doivent être "ramassés" dans
  // l'ordre AVANT P5, en UN SEUL lot (un seul appel de géométrie de
  // route), plutôt que d'être dépassés pour atteindre P5 directement.
  it("balaie plusieurs points alignés en un seul lot avant l'ancre plus lointaine (P1..P5)", async () => {
    const P1 = mkPoint("P1", 5.3505, -3.990); // ~55.6m
    const P2 = mkPoint("P2", 5.3510, -3.990); // ~111.2m
    const P3 = mkPoint("P3", 5.3515, -3.990); // ~166.8m
    const P4 = mkPoint("P4", 5.3520, -3.990); // ~222.4m
    const P5 = mkPoint("P5", 5.3525, -3.990); // ~278.0m — cible du lot

    const progressById = { P1: 55.6, P2: 111.2, P3: 166.8, P4: 222.4 };

    const fetchRoadDistances = async (fromLat, fromLng, candidates) => {
      const ids = candidates.map(c => c.id);
      if (ids.includes("P5")) {
        // Appel de sélection d'ancre : P5 gagne (accès routier direct),
        // les autres subiraient un détour s'ils étaient choisis comme ancre.
        return candidates.map(c => (c.id === "P5" ? 290 : 900));
      }
      // Appel de vérification d'accessibilité du balayage : P1..P4 sont
      // réellement accessibles, proches de leur progression géométrique.
      return candidates.map(c => progressById[c.id] + 10);
    };

    const { sequence, debugLog } = await planRouteAwareTour([P4, P2, P5, P1, P3], start, {
      fetchRoute: straightLineFetchRoute,
      fetchRoadDistances,
      debug: true
    });

    expect(sequence.map(p => p.id)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    // Un seul lot a suffi à capter les 5 points (pas 5 lots séparés).
    expect(debugLog).toHaveLength(1);
    expect(debugLog[0].selectedSequence).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });

  // Un point géométriquement proche de la polyligne peut néanmoins être
  // réellement inaccessible depuis elle (clôture, branche différente,
  // obstacle) — la vérification d'accessibilité routière doit l'exclure
  // du balayage même s'il est dans le corridor géométrique.
  it("exclut du balayage un point proche de la route mais réellement inaccessible", async () => {
    const onCorridorButBlocked = mkPoint("blocked", 5.3505, -3.990); // ~55.6m, sur la route
    const anchor = mkPoint("anchor", 5.3520, -3.990); // ~222.4m

    const fetchRoadDistances = async (fromLat, fromLng, candidates) => {
      const ids = candidates.map(c => c.id);
      if (ids.includes("anchor")) return candidates.map(c => (c.id === "anchor" ? 230 : 9999));
      // Vérification d'accessibilité du candidat "blocked" : distance
      // routée réelle très supérieure à sa progression géométrique
      // (~55.6m) -> détour déguisé, doit être écarté du lot.
      return candidates.map(() => 5000);
    };

    const { sequence } = await planRouteAwareTour([onCorridorButBlocked, anchor], start, {
      fetchRoute: straightLineFetchRoute,
      fetchRoadDistances
    });

    // "blocked" n'est pas capté dans le même lot que "anchor" (l'ancre
    // seule sort du premier lot) — il reste néanmoins dans la tournée,
    // traité séparément par la suite plutôt que perdu.
    expect(sequence[0].id).toBe("anchor");
    expect(sequence.map(p => p.id)).toContain("blocked");
  });

  it("hors-ligne (aucun fetchRoute) -> repli sur le glouton direction-aware, tournée quand même complète", async () => {
    const pts = [mkPoint("a", 5.36, -3.98), mkPoint("b", 5.37, -4.0)];
    const { sequence, debugLog } = await planRouteAwareTour(pts, start, { debug: true });
    expect(sequence.map(p => p.id).sort()).toEqual(["a", "b"]);
    expect(debugLog[0].leg).toBe("fallback-heuristic");
    expect(debugLog[0].reason).toBe("network-unavailable");
  });

  it("bascule en hors-ligne dès le premier échec réseau et termine quand même la tournée", async () => {
    const pts = [mkPoint("a", 5.36, -3.98), mkPoint("b", 5.37, -4.0), mkPoint("c", 5.35, -3.985)];
    const fetchRoute = async () => { throw new Error("network down"); };
    const { sequence } = await planRouteAwareTour(pts, start, { fetchRoute, debug: true });
    expect(sequence.map(p => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignore les points déjà visités et sans coordonnées valides", async () => {
    const pts = [
      mkPoint("visited", 5.36, -3.98, true),
      mkPoint("bad", null, null),
      mkPoint("ok", 5.361, -3.981)
    ];
    const { sequence } = await planRouteAwareTour(pts, start, { fetchRoute: straightLineFetchRoute });
    expect(sequence.map(p => p.id)).toEqual(["ok"]);
  });
});
