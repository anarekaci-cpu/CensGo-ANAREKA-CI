import { describe, it, expect } from "vitest";
import { stringSimilarity, normalizePointId, escapeHtml } from "../core/utils.js";

describe("stringSimilarity", () => {
  it("retourne 1 pour des chaînes identiques", () => {
    expect(stringSimilarity("Chez Awa", "Chez Awa")).toBe(1);
  });

  it("ignore la casse et les accents", () => {
    expect(stringSimilarity("Kouassi Kouadio", "KOUASSI KOUADIO")).toBe(1);
    expect(stringSimilarity("Étalage Bébé", "Etalage Bebe")).toBe(1);
  });

  it("retourne une similarité élevée pour une variante d'orthographe proche", () => {
    const sim = stringSimilarity("Kouassi", "Kwassi");
    expect(sim).toBeGreaterThan(0.7);
    expect(sim).toBeLessThan(1);
  });

  it("retourne une similarité faible pour des noms très différents", () => {
    expect(stringSimilarity("Chez Awa Restaurant", "Kiosque Bamba")).toBeLessThan(0.4);
  });

  it("retourne 0 si l'une des deux chaînes est vide/absente", () => {
    expect(stringSimilarity("", "Chez Awa")).toBe(0);
    expect(stringSimilarity(null, "Chez Awa")).toBe(0);
    expect(stringSimilarity(undefined, undefined)).toBe(0);
  });
});

describe("normalizePointId / escapeHtml (couverture existante conservée)", () => {
  it("normalizePointId trim et convertit en string", () => {
    expect(normalizePointId(123)).toBe("123");
    expect(normalizePointId(" abc ")).toBe("abc");
    expect(normalizePointId(null)).toBe("");
  });

  it("escapeHtml échappe les guillemets", () => {
    expect(escapeHtml('a "b" <c>')).toBe('a &quot;b&quot; &lt;c&gt;');
  });
});
