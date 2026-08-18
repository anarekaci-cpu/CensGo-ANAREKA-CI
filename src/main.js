import "./style.css";
import "maplibre-gl/dist/maplibre-gl.css";

import { initAuth } from "./modules/auth/auth.js";
import { initSyncEngine } from "./modules/sync/syncEngine.js";
import { initGeolocation } from "./modules/geolocation/geolocation.js";
import { App } from "./app.js";

async function bootstrap() {
  const app = document.getElementById("app");

  app.innerHTML = `
    <div id="boot-screen">
      <div class="boot-spinner"></div>
      <div class="boot-text">Chargement d'ANAREKA-CI...</div>
      <div class="boot-sub">V2.0 — IndexedDB + Sync</div>
    </div>
  `;

  try {
    const { db } = await import("./db/database.js");
    await db.open();
    console.log("📦 IndexedDB prête");

    await initSyncEngine();
    await initAuth();

    const appInstance = new App(app);
    await appInstance.mount();

    initGeolocation();

  } catch (err) {
    console.error("❌ Erreur au démarrage:", err);
    app.innerHTML = `
      <div id="boot-error">
        <div class="boot-icon">⚠️</div>
        <h2>Impossible de démarrer</h2>
        <p>${err.message}</p>
        <button onclick="location.reload()">Réessayer</button>
      </div>
    `;
  }
}

bootstrap();
