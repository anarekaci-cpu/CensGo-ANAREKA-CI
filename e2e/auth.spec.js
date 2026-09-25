import { test, expect } from "@playwright/test";
import { mockSupabase } from "./fixtures/supabaseMock.js";

/** Collecte les erreurs JS et les violations CSP pendant le test. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) errors.push(`csp: ${m.text()}`);
  });
  return errors;
}

async function login(page, password = "motdepasse1") {
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginBtn").click();
}

test.describe("Authentification", () => {
  test("écran d'accueil accessible, sans erreur JS ni violation CSP", async ({ page }) => {
    const errors = watchErrors(page);
    await mockSupabase(page);
    await page.goto("./");
    await expect(page.locator("#goLoginBtn")).toBeVisible();
    await expect(page.locator("#goSignupBtn")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    expect(errors).toEqual([]);
  });

  test("connexion d'un agent validé → carte et en-tête", async ({ page }) => {
    const errors = watchErrors(page);
    await mockSupabase(page, { role: "agent" });
    await login(page);
    await expect(page.locator("#app-container")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".brand-title")).toHaveText("CensGo");
    expect(errors).toEqual([]);
  });

  test("mauvais mot de passe → message clair", async ({ page }) => {
    await mockSupabase(page);
    await login(page, "mauvais-mdp");
    await expect(page.locator("#loginError")).toContainText("incorrect");
    await expect(page.locator("#app-container")).toHaveCount(0);
  });

  test("inscription : mot de passe trop faible refusé côté client", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("./");
    await page.locator("#goSignupBtn").click();
    await page.locator("#signupFirstName").fill("Awa");
    await page.locator("#signupLastName").fill("Koné");
    await page.locator("#signupEmail").fill("awa@example.ci");
    await page.locator("#signupPassword").fill("abcdefgh");
    await page.locator("#signupBtn").click();
    await expect(page.locator("#signupError")).toContainText("8 caractères");
  });
});
