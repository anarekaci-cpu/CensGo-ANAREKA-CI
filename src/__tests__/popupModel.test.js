import { describe, it, expect } from "vitest";
import { buildPopupModel } from "../modules/census/popupModel.js";

/**
 * Problème #1 — le popup doit afficher TOUTES les informations du point.
 * Le modèle est pur : on teste les données, pas le DOM.
 */
const basePoint = {
  id: "42",
  order: 7,
  block: 3,
  name: "Chez Awa",
  tel: "0707070707",
  address: "Rue 12, Villa 4",
  quartier: "Riviera 3",
  etablissement: "Kiosque Awa",
  activityType: "Kiosque d'attiéké",
  produits: "Attiéké, poisson",
  sexe: "Femme",
  status: "VERT (Joignable)",
  visited: true,
  lat: 5.36,
  lon: -3.97,
  createdAt: "2026-01-15T10:00:00Z",
  updatedAt: "2026-02-20T09:30:00Z",
  createdBy: "agent.koffi",
  zone: "Cocody"
};

describe("buildPopupModel", () => {
  it("expose tous les champs requis", () => {
    const m = buildPopupModel(basePoint, null);
    expect(m.id).toBe("42");
    expect(m.name).toBe("Chez Awa");
    expect(m.tel).toBe("0707070707");
    expect(m.address).toBe("Rue 12, Villa 4");
    expect(m.quartier).toBe("Riviera 3");
    expect(m.etablissement).toBe("Kiosque Awa");
    expect(m.activityType).toBe("Kiosque d'attiéké");
    expect(m.produits).toBe("Attiéké, poisson");
    expect(m.sexe).toBe("Femme");
    expect(m.status).toBe("VERT (Joignable)");
    expect(m.visited).toBe(true);
    expect(m.lat).toBe(5.36);
    expect(m.lon).toBe(-3.97);
    expect(m.agent).toBe("agent.koffi");
    expect(m.zone).toBe("Cocody");
  });

  it("formate les dates de recensement et de mise à jour", () => {
    const m = buildPopupModel(basePoint, null);
    expect(m.createdAt).toMatch(/2026/);
    expect(m.updatedAt).toMatch(/2026/);
  });

  it("calcule la distance avec la position utilisateur", () => {
    // ~2.2 km au nord du point
    const m = buildPopupModel(basePoint, { lat: 5.38, lng: -3.97 });
    expect(m.distanceLabel).toContain("m");
    expect(m.distanceLabel).toContain("de vous");
  });

  it("pas de distance sans position GPS (popup fonctionnel quand même)", () => {
    const m = buildPopupModel(basePoint, null);
    expect(m.distanceLabel).toBe("");
    expect(m.name).toBe("Chez Awa");
  });

  it("point sans nom -> libellé explicite, jamais undefined en HTML", () => {
    const m = buildPopupModel({ ...basePoint, name: "" }, null);
    expect(m.name).toBe("(sans nom)");
  });

  it("champs absents -> chaînes vides (le rendu affiche —)", () => {
    const m = buildPopupModel({ ...basePoint, tel: "", address: "", produits: "", createdBy: null, zone: null }, null);
    expect(m.tel).toBe("");
    expect(m.address).toBe("");
    expect(m.produits).toBe("");
    expect(m.agent).toBe("");
    expect(m.zone).toBe("");
  });

  it("dates invalides -> chaîne vide plutôt que 'Invalid Date'", () => {
    const m = buildPopupModel({ ...basePoint, createdAt: "pas-une-date" }, null);
    expect(m.createdAt).toBe("");
  });
});
