import { test, expect } from "@playwright/test";
import { mockSupabase } from "./fixtures/supabaseMock.js";
import { fileURLToPath } from "node:url";

const PHOTO = fileURLToPath(new URL("./fixtures/photo.png", import.meta.url));

async function loginAsAgent(page, opts) {
  await mockSupabase(page, opts);
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill("motdepasse1");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app-container")).toBeVisible({ timeout: 20_000 });
}

test.describe("Recensement", () => {
  test("le bouton central ouvre le formulaire, champs obligatoires signalés", async ({ page }) => {
    await loginAsAgent(page);
    await page.locator("#navTabFabAdd").click();
    await expect(page.locator("#cf_name")).toBeVisible();
    await expect(page.locator("#cf_city option", { hasText: "Bingerville" })).toHaveCount(1);
    // Formulaire vierge : pas d'erreur rouge avant toute saisie.
    await expect(page.locator("#cf_name_val")).toHaveText("");
    await expect(page.locator("#censusValStatusText")).toContainText("À remplir");
    await page.locator("#cf_save_btn").click();
    // Après tentative : ce qui manque est listé précisément, rien n'est envoyé.
    await expect(page.locator("#censusValStatusText")).toContainText("Il manque : nom");
    await expect(page.locator("#cf_name_val")).toHaveText("Requis");
    await expect(page.locator("#cf_name")).toBeVisible();
  });

  test("aperçu photo affiché (CSP blob:) après sélection", async ({ page }) => {
    await loginAsAgent(page);
    await page.locator("#navTabFabAdd").click();
    await page.locator("#cf_photo").setInputFiles(PHOTO);
    const img = page.locator("#cf_photoPreview img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("fiche complète enregistrée et envoyée à Supabase", async ({ page }) => {
    const writes = [];
    await loginAsAgent(page, { onWrite: (table, body, method) => writes.push({ table, body, method }) });
    await page.locator("#navTabFabAdd").click();
    await page.locator("#cf_name").fill("Adjoua Test");
    await page.locator("#cf_tel").fill("0708091011");
    await page.locator('[data-activity="Kiosque d\'attiéké fixe"]').click();
    await page.locator("#cf_city").selectOption("Bingerville");
    await page.locator("#cf_photo").setInputFiles(PHOTO);
    await expect(page.locator("#cf_photoPreview img")).toBeVisible();
    await page.locator("#cf_lat").fill("5.3560");
    await page.locator("#cf_lon").fill("-3.8840");
    await page.locator("#cf_save_btn").click();
    // Régression : après un enregistrement réussi, le formulaire se ferme
    // sans demander "Fermer sans enregistrer ?".
    await expect(page.getByText("Fermer sans enregistrer")).toHaveCount(0);
    await expect(page.locator("#censusFormModal")).toBeHidden();
    await expect.poll(() => writes.some(w => w.table.startsWith("census_points")), { timeout: 10_000 }).toBe(true);
    const sent = writes.find(w => w.table.startsWith("census_points")).body;
    const row = Array.isArray(sent) ? sent[0] : sent;
    expect(row.name).toBe("Adjoua Test");
    expect(row.city).toBe("Bingerville");
  });
});
