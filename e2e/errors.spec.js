import { test, expect } from "@playwright/test";
import { mockSupabase } from "./fixtures/supabaseMock.js";

test("une erreur JS terrain est remontée, sans donnée personnelle", async ({ page }) => {
  const writes = [];
  await mockSupabase(page, { onWrite: (table, body) => writes.push({ table, body }) });
  await page.goto("./");
  await page.locator("#goLoginBtn").click();
  await page.locator("#loginEmail").fill("agent.test@anareka.ci");
  await page.locator("#loginPassword").fill("motdepasse1");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app-container")).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => setTimeout(() => { throw new Error("Échec fiche de awa@example.ci 0708091011"); }, 0));

  await expect.poll(() => writes.filter(w => w.table.startsWith("client_errors")).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const rows = writes.filter(w => w.table.startsWith("client_errors")).flatMap(w => w.body);
  const row = rows.find(r => r.message.includes("Échec fiche"));
  expect(row).toBeTruthy();
  expect(row.message).not.toContain("awa@example.ci");
  expect(row.message).not.toContain("0708091011");
  expect(row.source).toBe("window.error");
});
