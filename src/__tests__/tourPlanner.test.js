import { describe, it, expect } from "vitest";
import { generateOptimizedTour, MAX_TOUR_STOPS } from "../core/tourPlanner.js";

// Abidjan ~ (5.35, -3.99)
const mkPoint = (id, lat, lon, visited = false) => ({ id, lat, lon, visited });

describe("generateOptimizedTour", () => {
  const start = { lat: 5.35, lng: -3.99 };

  it("ignore les points déjà visités", () => {
    const tour = generateOptimizedTour(
      [mkPoint("a", 5.36, -3.98, true), mkPoint("b", 5.37, -4.0, false)],
      start
    );
    expect(tour.map(p => p.id)).toEqual(["b"]);
  });

  it("ignore les points sans coordonnées valides", () => {
    const tour = generateOptimizedTour(
      [mkPoint("bad", null, null), mkPoint("ok", 5.36, -3.98)],
      start
    );
    expect(tour).toHaveLength(1);
    expect(tour[0].id).toBe("ok");
  });

  it("liste vide -> tournée vide", () => {
    expect(generateOptimizedTour([], start)).toEqual([]);
  });

  it("ordre plus-proche-voisin : le point adjacent vient en premier", () => {
    const tour = generateOptimizedTour([
      mkPoint("loin", 5.60, -4.30),
      mkPoint("proche", 5.3505, -3.9905),
      mkPoint("moyen", 5.40, -4.05)
    ], start);
    expect(tour[0].id).toBe("proche");
    expect(tour).toHaveLength(3);
  });

  it("chaque arrêt porte distanceFromPrev", () => {
    const tour = generateOptimizedTour([mkPoint("a", 5.36, -3.98), mkPoint("b", 5.37, -4.0)], start);
    expect(tour[0].distanceFromPrev).toBeGreaterThan(0);
    expect(typeof tour[1].distanceFromPrev).toBe("number");
  });

  // Cas réel signalé (audit, capture d'écran) : le glouton pur (distance
  // seule) choisissait un point géométriquement un peu plus proche mais
  // hors de l'axe déjà engagé, plutôt que de "ramasser" au passage les
  // points alignés sur la direction de progression — provoquant un détour
  // puis un retour en arrière au lieu d'une progression naturelle.
  it("privilégie la continuation sur l'axe engagé plutôt qu'un point hors-axe légèrement plus proche", () => {
    const start = { lat: 5.350, lng: -3.990 };
    // A droit au nord du départ (~111m) ; B droit au nord de A (~111m de
    // plus, même cap) ; X à l'est de A (~90m, donc plus proche de A que B)
    // mais à 90° du cap nord déjà établi par le trajet départ->A.
    const A = mkPoint("A", 5.3510, -3.9900);
    const B = mkPoint("B", 5.3520, -3.9900);
    const X = mkPoint("X", 5.3510, -3.98919);

    const tour = generateOptimizedTour([B, X, A], start);

    expect(tour.map(p => p.id)).toEqual(["A", "B", "X"]);
  });

  // Reprend le scénario ci-dessus mais avec une troisième étape (C) sur le
  // même axe, pour vérifier le "ramassage" complet dans l'ordre naturel
  // avant le détour vers X — exactement le comportement attendu décrit
  // dans le rapport terrain (sweep avant détour).
  it("balaie plusieurs points alignés dans l'ordre avant de faire le détour", () => {
    const start = { lat: 5.350, lng: -3.990 };
    const A = mkPoint("A", 5.3510, -3.9900);
    const B = mkPoint("B", 5.3520, -3.9900);
    const C = mkPoint("C", 5.3530, -3.9900);
    const X = mkPoint("X", 5.3510, -3.98919);

    const tour = generateOptimizedTour([C, B, X, A], start);

    expect(tour.map(p => p.id)).toEqual(["A", "B", "C", "X"]);
  });

  // Le cap GPS live (startPos.heading) sert de direction de progression
  // déjà établie pour le TOUT PREMIER choix, avant même le premier
  // déplacement — sans lui, rien ne distingue "devant" de "à côté" pour ce
  // premier point (voir aussi le test suivant, sans heading fourni).
  it("utilise le cap GPS live pour orienter le tout premier choix", () => {
    // X légèrement plus proche du départ que N, mais à l'est (90°) alors
    // que l'agent se déplace vers le nord (heading=0).
    const N = mkPoint("N", 5.3510, -3.9900);   // ~111m au nord, cap 0°
    const X = mkPoint("X", 5.3502, -3.98919);  // ~90m à l'est, cap ~90°

    const withHeading = generateOptimizedTour([X, N], { lat: 5.350, lng: -3.990, heading: 0 });
    expect(withHeading[0].id).toBe("N");

    // Sans heading connu, le premier choix reste un plus-proche-voisin pur.
    const withoutHeading = generateOptimizedTour([X, N], { lat: 5.350, lng: -3.990 });
    expect(withoutHeading[0].id).toBe("X");
  });

  // forcedFirstStopId : correctif "premier arrêt = résultat de 'Plus
  // proche'" (audit terrain — le glouton géométrique ignore la route réelle
  // pour TOUS ses choix, l'appelant corrige au moins le tout premier via un
  // calcul routier séparé, voir appView.js: tourBtn).
  describe("forcedFirstStopId", () => {
    it("impose le premier arrêt même s'il n'est pas le plus proche géométriquement", () => {
      // "loin" est objectivement plus proche à vol d'oiseau que "route" —
      // sans forçage, le glouton choisirait "loin" en premier (cf. test
      // "ordre plus-proche-voisin" ci-dessus). Le forçage doit l'emporter.
      const proche = mkPoint("proche", 5.3505, -3.9905);
      const route = mkPoint("route", 5.40, -4.05);

      const tour = generateOptimizedTour([proche, route], start, undefined, "route");
      expect(tour[0].id).toBe("route");
      expect(tour.map(p => p.id)).toEqual(["route", "proche"]);
    });

    it("le 2-opt ne peut pas échanger le premier arrêt imposé", () => {
      // Même géométrie que le test "balaie plusieurs points alignés" —
      // sans lockFirstStop, le 2-opt réordonnerait A/B/C par distance pure ;
      // avec un forçage sur B, B doit rester en première position même si
      // ça laisse un trajet géométriquement moins optimal.
      const A = mkPoint("A", 5.3510, -3.9900);
      const B = mkPoint("B", 5.3520, -3.9900);
      const C = mkPoint("C", 5.3530, -3.9900);

      const tour = generateOptimizedTour([C, A, B], start, undefined, "B");
      expect(tour[0].id).toBe("B");
    });

    it("id forcé absent de la liste : repli silencieux sur le glouton normal", () => {
      const tour = generateOptimizedTour(
        [mkPoint("proche", 5.3505, -3.9905), mkPoint("loin", 5.60, -4.30)],
        start, undefined, "inexistant"
      );
      expect(tour[0].id).toBe("proche");
    });
  });

  it("plafonné à MAX_TOUR_STOPS — pas d'explosion O(N²) sur 10k points", () => {
    const pts = [];
    for (let i = 0; i < 10000; i++) {
      pts.push(mkPoint(`p${i}`, 5.0 + Math.random() * 1.0, -4.5 + Math.random() * 1.0));
    }
    const t0 = performance.now();
    const tour = generateOptimizedTour(pts, start);
    const ms = performance.now() - t0;
    expect(tour.length).toBe(MAX_TOUR_STOPS);
    // Sur un CPU moderne, le plafond doit garder ce calcul sous ~500ms
    // (le naïf sur 10k points prenait plusieurs secondes).
    expect(ms).toBeLessThan(500);
  });
});
