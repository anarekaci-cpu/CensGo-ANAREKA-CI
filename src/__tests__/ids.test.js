import { describe, it, expect } from "vitest";
import { normalizePointId } from "../core/utils.js";
import { normalizePoint } from "../core/normalize.js";

/**
 * Problème #2 — cohérence des IDs de bout en bout.
 * Un même point doit être retrouvé quel que soit le type de son id
 * (number venu de Supabase/vieux cache, string venue du DOM dataset
 * ou d'un UUID offline).
 */
describe("normalizePointId", () => {
  it("123 (number) et \"123\" (string) produisent le MÊME id", () => {
    expect(normalizePointId(123)).toBe(normalizePointId("123"));
    expect(normalizePointId(123)).toBe("123");
  });

  it("normalise les UUID offline", () => {
    const uuid = "arka_ab12-cd34";
    expect(normalizePointId(uuid)).toBe(uuid);
  });

  it("trimme les espaces parasites", () => {
    expect(normalizePointId("  42 ")).toBe("42");
  });

  it("retourne \"\" pour null/undefined — jamais la string \"null\"", () => {
    expect(normalizePointId(null)).toBe("");
    expect(normalizePointId(undefined)).toBe("");
    expect(normalizePointId(0)).toBe("0");
  });
});

describe("lookup marker -> store avec ids mixtes", () => {
  // Simule l'index construit par markers.rebuildPointIndex() : les clés sont
  // toujours normalisées, donc un id DOM (string) retrouve un point stocké
  // avec un id numérique (vieux cache IndexedDB) et inversement.
  function buildIndex(points) {
    const idx = new Map();
    for (const p of points) idx.set(normalizePointId(p.id), p);
    return idx;
  }

  const store = [
    { id: 101, name: "Point A" },      // id NUMBER (vieux cache)
    { id: "arka_uuid-b", name: "Point B" }, // id STRING UUID (création offline)
    { id: "102", name: "Point C" }     // id STRING (données normalisées récentes)
  ];
  const index = buildIndex(store);

  it("trouve A via dataset.id string", () => {
    expect(index.get(normalizePointId("101"))?.name).toBe("Point A");
  });

  it("trouve B via son UUID", () => {
    expect(index.get(normalizePointId("arka_uuid-b"))?.name).toBe("Point B");
  });

  it("trouve C quel que soit le type utilisé", () => {
    expect(index.get(normalizePointId(102))?.name).toBe("Point C");
    expect(index.get(normalizePointId("102"))?.name).toBe("Point C");
  });

  it("compare p.id === point.id sans faux négatif via normalisation", () => {
    const clicked = index.get(normalizePointId("101"));
    const matches = store.filter(p => normalizePointId(p.id) === normalizePointId(clicked.id));
    expect(matches).toHaveLength(1);
  });
});

describe("normalizePoint garantit des ids string", () => {
  it("convertit un point_id Supabase numérique en string", () => {
    const p = normalizePoint({ point_id: 555, name: "X" });
    expect(p.id).toBe("555");
    expect(typeof p.id).toBe("string");
  });

  it("préserve un id déjà string", () => {
    expect(normalizePoint({ id: "abc" }).id).toBe("abc");
  });
});
