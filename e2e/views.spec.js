import { test, expect } from "@playwright/test";
import { mockSupabase } from "./fixtures/supabaseMock.js";

// Tests de fumée des écrans extraits de appView.js (views/*) : chacun
// s'ouvre, affiche ses données et ne lève aucune erreur JS.
async function login(page, role = "agent") {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await mockSupabase(page, { role });
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill("motdepasse1");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app-container")).toBeVisible({ timeout: 20_000 });
  // Le rôle est chargé en asynchrone : attendre qu'il soit appliqué à l'UI.
  if (role === "admin") await expect(page.locator("#exportRow")).toHaveCSS("display", "flex");
  return errors;
}

test("statistiques et filtres : la ville filtre bien les fiches", async ({ page }) => {
  const errors = await login(page);
  await expect(page.locator("#statsHeader")).toContainText("1 / 2");
  await page.locator("#menuToggleBtn").click();
  await expect(page.locator("#filterCity option", { hasText: "Bingerville" })).toHaveCount(1);
  await page.locator("#filterVisited").selectOption({ index: 1 });
  await expect(page.locator("#statsHeader")).not.toContainText("Chargement");
  expect(errors).toEqual([]);
});

test("rapports : l'agent voit ses propres fiches", async ({ page }) => {
  const errors = await login(page);
  await page.locator("#navTabReports").click();
  await expect(page.locator("#agentReportModal")).toBeVisible();
  await expect(page.locator("#agentReportModal")).toContainText("Kiosque Awa");
  expect(errors).toEqual([]);
});

test("admin : comptes, villes et erreurs terrain", async ({ page }) => {
  const errors = await login(page, "admin");
  await page.locator("#navTabProfile").click();
  await expect(page.locator("#agentsModal")).toBeVisible();
  await expect(page.locator("#agentsList")).toContainText("nouveau@example.ci");
  await expect(page.locator("#citiesList")).toContainText("Bingerville");
  await expect(page.locator("#errorsList")).toContainText("Aucune erreur");
  expect(errors).toEqual([]);
});

test("export CSV (admin) : un fichier est téléchargé", async ({ page }) => {
  const errors = await login(page, "admin");
  await page.locator("#menuToggleBtn").click();
  const download = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  expect(errors).toEqual([]);
});

test("assistant IA : le panneau s'ouvre", async ({ page }) => {
  const errors = await login(page);
  await page.locator("#menuToggleBtn").click();
  await page.locator("#aiModalBtnControl").click();
  await expect(page.locator("#aiModal")).toBeVisible();
  expect(errors).toEqual([]);
});

test("export CSV masqué pour un agent", async ({ page }) => {
  await login(page, "agent");
  await page.locator("#menuToggleBtn").click();
  await expect(page.locator("#exportBtn")).toBeHidden();
});
