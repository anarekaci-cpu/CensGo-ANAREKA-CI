import { describe, it, expect } from "vitest";
import { normalizePoint, normalizePoints, isValidLatLng } from "../core/normalize.js";

describe("normalizePoint", () => {
  it("normalise une ligne Supabase snake_case complète", () => {
    const p = normalizePoint({
      point_id: "bgv_001",
      block: 3,
      order: 12,
      name: "Kouadio Koffi",
      tel: "0708091011",
      etablissement: "Chez Aya",
      activity_type: "Kiosque d'attiéké fixe",
      quartier: "Cocody",
      address: "En face du marché",
      produits: "Attiéké Poisson",
      sexe: "Femme",
      status: "VERT (Joignable)",
      visited: "oui",
      lat: 5.35,
      lon: -3.99,
      updated_at: "2026-01-15T10:00:00Z"
    });
    expect(p.id).toBe("bgv_001");
    expect(p.activityType).toBe("Kiosque d'attiéké fixe");
    expect(p.visited).toBe(true);
    expect(p.lat).toBe(5.35);
    expect(p.lon).toBe(-3.99);
    expect(p.updatedAt).toBe("2026-01-15T10:00:00Z");
  });

  it("force l'id en string (jamais number) — marker -> store -> popup", () => {
    const p = normalizePoint({ id: 42 });
    expect(p.id).toBe("42");
    expect(typeof p.id).toBe("string");
  });

  it("gère les valeurs nulles SQL sans lever d'exception", () => {
    const p = normalizePoint({
      point_id: null, name: null, tel: null, lat: null, lon: null,
      visited: null, status: null
    });
    // id vide -> sera filtré par normalizePoints, mais ne doit pas planter
    expect(p.id).toBe("");
    expect(p.name).toBe("");
    expect(p.status).toBe("NON DEFINI");
    expect(p.visited).toBe(false);
    expect(p.lat).toBeNull();
    expect(p.lon).toBeNull();
  });

  it("objet totalement invalide -> point dégradé sans exception", () => {
    expect(() => normalizePoint(null)).not.toThrow();
    expect(() => normalizePoint("chaîne")).not.toThrow();
    expect(normalizePoint(undefined).id).toBe("");
  });

  it("coordonnées hors bornes -> null + flag invalidCoords", () => {
    const p = normalizePoint({ id: "x", lat: 999, lon: -200 });
    expect(p.lat).toBeNull();
    expect(p.lon).toBeNull();
    expect(p.invalidCoords).toBe(true);
  });

  it("coordonnées numériques invalides (NaN texte) -> null", () => {
    const p = normalizePoint({ id: "x", lat: "abc", lon: "" });
    expect(p.lat).toBeNull();
    expect(p.lon).toBeNull();
  });

  it("bornes exactes acceptées (-90/90, -180/180)", () => {
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(90.0001, 0)).toBe(false);
  });

  it("visited accepte true / 'true' / 'oui' / 1", () => {
    expect(normalizePoint({ id: "a", visited: true }).visited).toBe(true);
    expect(normalizePoint({ id: "a", visited: "true" }).visited).toBe(true);
    expect(normalizePoint({ id: "a", visited: "oui" }).visited).toBe(true);
    expect(normalizePoint({ id: "a", visited: 1 }).visited).toBe(true);
    expect(normalizePoint({ id: "a", visited: false }).visited).toBe(false);
    expect(normalizePoint({ id: "a", visited: "non" }).visited).toBe(false);
  });
});

describe("normalizePoints", () => {
  it("déduplique par id (dernier gagne)", () => {
    const rows = [
      { id: "p1", name: "Premier" },
      { id: "p1", name: "Dernier" },
      { id: "p2", name: "Autre" }
    ];
    const pts = normalizePoints(rows);
    expect(pts).toHaveLength(2);
    expect(pts.find(p => p.id === "p1").name).toBe("Dernier");
  });

  it("élimine les entrées sans identifiant", () => {
    const pts = normalizePoints([{ name: "sans id" }, { id: "ok" }]);
    expect(pts).toHaveLength(1);
    expect(pts[0].id).toBe("ok");
  });

  it("entrée non-tableau -> []", () => {
    expect(normalizePoints(null)).toEqual([]);
    expect(normalizePoints("x")).toEqual([]);
  });

  it("1000 points avec doublons -> aucun doublon en sortie", () => {
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      rows.push({ id: `p${i % 500}`, name: `N${i}`, lat: 5 + i * 0.0001, lon: -4 });
    }
    const pts = normalizePoints(rows);
    expect(pts).toHaveLength(500);
    expect(new Set(pts.map(p => p.id)).size).toBe(500);
  });
});
