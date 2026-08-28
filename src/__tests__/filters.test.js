import { describe, it, expect } from "vitest";
import { passesFilters, filterPoints, DEFAULT_FILTERS } from "../core/filters.js";

const P = (id, { block = 1, status = "VERT (Joignable)", visited = false, name = "", city = "", quartier = "", address = "", tel = "", produits = "" } = {}) =>
  ({ id, block, status, visited, name, city, quartier, address, tel, produits });

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

  it("filtre par ville", () => {
    const f = { ...DEFAULT_FILTERS, city: "Cocody" };
    expect(passesFilters(P("a", { city: "Cocody" }), f)).toBe(true);
    expect(passesFilters(P("b", { city: "Bingerville" }), f)).toBe(false);
    // Liste fermée gérée par l'admin -> comparaison stricte, pas de recherche floue.
    expect(passesFilters(P("c", { city: "cocody" }), f)).toBe(false);
  });

  it("recherche sur nom, ville, quartier, tel", () => {
    const f = { ...DEFAULT_FILTERS, search: "aya" };
    expect(passesFilters(P("a", { name: "Chez Aya" }), f)).toBe(true);
    expect(passesFilters(P("b", { quartier: "Ayamé" }), f)).toBe(true);
    expect(passesFilters(P("c", { tel: "0708091011" }), { ...DEFAULT_FILTERS, search: "0708" })).toBe(true);
    expect(passesFilters(P("d", { name: "Kouadio" }), f)).toBe(false);
    expect(passesFilters(P("e", { city: "Grand-Bassam" }), { ...DEFAULT_FILTERS, search: "bassam" })).toBe(true);
  });

  it("recherche insensible aux accents (clavier sans accents courant sur le terrain)", () => {
    const point = P("a", { name: "Kiosque Attiéké", quartier: "Général" });
    expect(passesFilters(point, { ...DEFAULT_FILTERS, search: "attieke" })).toBe(true);
    expect(passesFilters(point, { ...DEFAULT_FILTERS, search: "general" })).toBe(true);
    // Fonctionne aussi dans l'autre sens (requête accentuée, donnée non accentuée).
    expect(passesFilters(P("b", { name: "Maquis Deba" }), { ...DEFAULT_FILTERS, search: "débà" })).toBe(true);
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
