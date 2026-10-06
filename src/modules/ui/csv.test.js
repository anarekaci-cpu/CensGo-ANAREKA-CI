import { describe, it, expect } from "vitest";
import { sanitizeCsvCell, toCsv } from "./csv.js";

describe("csv", () => {
  it("préfixe les cellules dangereuses", () => {
    for (const s of ["=1+1", "+225", "-2", "@SUM(A1)", "\tx", "\rx"]) {
      expect(sanitizeCsvCell(s)).toBe(`'${s}`);
    }
  });
  it("laisse intactes les valeurs normales et les nombres", () => {
    expect(sanitizeCsvCell("Awa")).toBe("Awa");
    expect(sanitizeCsvCell(-3.96)).toBe("-3.96");
    expect(sanitizeCsvCell(null)).toBe("");
  });
  it("échappe les guillemets", () => {
    expect(toCsv([["a\"b", "=x"]])).toBe('"a""b","\'=x"');
  });
});
