import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Garde-fou CSP : l'aperçu photo du formulaire de recensement
// (censusFormModal.js) affiche un blob: issu de URL.createObjectURL().
// Sans "blob:" dans img-src, le navigateur bloque l'image en silence.
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.html"), "utf8");
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
const directive = (name) => (csp.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ")) || "").split(/\s+/).slice(1);

describe("Content-Security-Policy (index.html)", () => {
  it("est présente", () => {
    expect(csp).not.toBe("");
  });

  it("autorise les images blob: pour l'aperçu photo", () => {
    expect(directive("img-src")).toContain("blob:");
  });

  it("n'autorise pas de script inline", () => {
    const scriptSrc = directive("script-src");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
