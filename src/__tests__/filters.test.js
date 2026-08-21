import { describe, it, expect } from "vitest";
import { passesFilters, filterPoints, DEFAULT_FILTERS } from "../core/filters.js";

const P = (id, { block = 1, status = "VERT (Joignable)", visited = false, name = "", quartier = "", address = "", tel = "", produits = "" } = {}) =>
  ({ id, block, status, visited, name, quartier, address, tel, produits });

describe("passesFilters", () => {
  it("filtres par défaut -> tout passe", () => {
    expect(passesFilters(P("a"), DEFAULT_FILTERS)).toBe(true);
  });

  it("filtre par bloc", () => {
    const f = { ...DEFAULT_FILTERS, block: "2" };
    expect(passesFilters(P("a", { block: 2 }), f)).toBe(true);
    expect(passesFilters(P("b", { block: 1 }), f)).toBe(false);
  });

  it("filtre par statut", () => {
    const f = { ...DEFAULT_FILTERS, status: "ROUGE (Refus)" };
    expect(passesFilters(P("a", { status: "ROUGE (Refus)" }), f)).toBe(true);
    expect(passesFilters(P("b", { status: "VERT (Joignable)" }), f)).toBe(false);
  });

  it("filtre visités / non visités", () => {
    const yes = { ...DEFAULT_FILTERS, visited: "yes" };
    const no = { ...DEFAULT_FILTERS, visited: "no" };
    expect(passesFilters(P("a", { visited: true }), yes)).toBe(true);
    expect(passesFilters(P("b", { visited: false }), yes)).toBe(false);
    expect(passesFilters(P("b", { visited: false }), no)).toBe(true);
  });

  it("recherche sur nom, quartier, tel", () => {
    const f = { ...DEFAULT_FILTERS, search: "aya" };
    expect(passesFilters(P("a", { name: "Chez Aya" }), f)).toBe(true);
    expect(passesFilters(P("b", { quartier: "Ayamé" }), f)).toBe(true);
    expect(passesFilters(P("c", { tel: "0708091011" }), { ...DEFAULT_FILTERS, search: "0708" })).toBe(true);
    expect(passesFilters(P("d", { name: "Kouadio" }), f)).toBe(false);
  });

  it("combinaison de plusieurs filtres (ET logique)", () => {
    const f = { block: "1", status: "VERT (Joignable)", visited: "no", search: "cocody" };
    expect(passesFilters(P("a", { block: 1, quartier: "Cocody" }), f)).toBe(true);
    expect(passesFilters(P("b", { block: 2, quartier: "Cocody" }), f)).toBe(false);
    expect(passesFilters(P("c", { block: 1, quartier: "Yopougon" }), f)).toBe(false);
  });

  it("point null -> false sans exception", () => {
    expect(passesFilters(null, DEFAULT_FILTERS)).toBe(false);
  });
});

describe("filterPoints", () => {
  const pts = [
    P("a", { block: 1, visited: true }),
    P("b", { block: 2 }),
    P("c", { block: 1 })
  ];

  it("aucun filtre actif -> même instance (pas de copie inutile)", () => {
    const out = filterPoints(pts, DEFAULT_FILTERS);
    expect(out).toBe(pts);
  });

  it("filtre actif -> liste filtrée", () => {
    const out = filterPoints(pts, { ...DEFAULT_FILTERS, block: "1" });
    expect(out.map(p => p.id)).toEqual(["a", "c"]);
  });

  it("reset des filtres -> tous les points reviennent", () => {
    const filtered = filterPoints(pts, { ...DEFAULT_FILTERS, visited: "yes" });
    expect(filtered).toHaveLength(1);
    const reset = filterPoints(pts, DEFAULT_FILTERS);
    expect(reset).toHaveLength(3);
  });
});
