/**
 * Utilitaires CSV partagés. Neutralise l'injection de formules (CSV/Excel
 * injection) : une cellule texte commençant par = + - @ tab ou CR est
 * préfixée d'une apostrophe pour que le tableur ne l'évalue pas.
 * Les vrais nombres (lat/lon négatifs) ne sont pas modifiés.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = String(value ?? "");
  return FORMULA_START.test(s) ? `'${s}` : s;
}

export function toCsv(rows) {
  return rows
    .map(r => r.map(v => `"${sanitizeCsvCell(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
