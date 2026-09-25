import { defineConfig, devices } from "@playwright/test";

// Tests E2E : l'app est construite avec une URL Supabase factice
// (https://e2e-test.supabase.co) interceptée par e2e/fixtures/supabaseMock.js.
// Aucune donnée ni clé réelle n'est utilisée.
const PORT = 4321;
const BASE = "/CensGo-ANAREKA-CI/";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block", // le SW précache interfère avec page.route()
    locale: "fr-FR",
    timezoneId: "Africa/Abidjan",
    geolocation: { latitude: 5.3553, longitude: -3.8836 },
    permissions: ["geolocation"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
  },
  projects: [
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
    { name: "mobile-dark", use: { ...devices["Pixel 7"], colorScheme: "dark" } }
  ],
  webServer: {
    command: `vite build --outDir dist-e2e --emptyOutDir && vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: "https://e2e-test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
      VITE_APP_ENV: "test",
      VITE_ENABLE_ERROR_REPORTING: "true",
      VITE_ENABLE_CONSENT: "true"
    }
  }
});
