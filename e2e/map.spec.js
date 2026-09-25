import { test, expect } from "@playwright/test";
import { mockSupabase } from "./fixtures/supabaseMock.js";

// La carte se charge réellement (style local, voir supabaseMock) : couvre
// l'initialisation MapLibre, son worker (sources GeoJSON) et les marqueurs.
test("la carte se charge, marqueurs et carte de densité sans erreur", async ({ page }) => {
  const problems = [];
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    const t = m.text();
    // Tuiles/sprites bloqués volontairement (réseau coupé en test) : attendu.
    if (/AJAXError|Failed to fetch|ERR_FAILED/i.test(t)) return;
    if (m.type() === "error" && /worker|webgl|maplibre|Content Security Policy/i.test(t)) problems.push(t);
  });
  await mockSupabase(page);
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill("motdepasse1");
  await page.locator("#loginBtn").click();

  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
  // Les marqueurs ne sont dessinés que dans la zone visible : cadrer sur
  // les fiches (Bingerville), puis vérifier qu'elles apparaissent.
  await page.locator("#menuToggleBtn").click();
  await page.locator("#fitFilteredBtn").click();
  await expect(page.locator(".maplibregl-marker").first()).toBeAttached({ timeout: 15_000 });
  // L'attribution de la carte reste repliée (elle recouvrait la légende).
  await expect(page.locator(".maplibregl-ctrl-attrib")).not.toHaveAttribute("open", /.*/);

  // Carte de densité : source GeoJSON => traitée par le worker MapLibre.
  await page.locator("#menuToggleBtn").click();
  await page.locator("#heatmapBtn").click();
  await page.waitForTimeout(1500);
  expect(problems).toEqual([]);
});

test("sans WebGL2 : message clair, le reste de l'app reste utilisable", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === "webgl2") return null;
      return orig.call(this, type, ...rest);
    };
  });
  await mockSupabase(page);
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill("motdepasse1");
  await page.locator("#loginBtn").click();
  await expect(page.locator(".map-unavailable")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#statsHeader")).toContainText("1 / 2");
  await page.locator("#navTabFabAdd").click();
  await expect(page.locator("#cf_name")).toBeVisible();
});
