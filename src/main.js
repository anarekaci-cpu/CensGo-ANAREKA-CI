import "./style.css";
import "maplibre-gl/dist/maplibre-gl.css";

import { initAuth } from "./modules/auth/auth.js";
import { initSyncEngine } from "./modules/sync/syncEngine.js";
import { initGeolocation } from "./modules/geolocation/geolocation.js";
import { App } from "./appShell.js";
import { db } from "./db/database.js";
import { store } from "./core/store.js";
import { isDiagEnabled, diagInstallFakeUser, diagSeedPointsIfEmpty } from "./core/diagnostics.js";

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
    await db.open();
    console.log("📦 IndexedDB prête");

    // Mode diagnostic (localStorage.DIAG=1) : session factice + données de
    // test pour reproduire le flux complet sans identifiants. Inertre sinon.
    if (isDiagEnabled()) {
      diagInstallFakeUser();
      await diagSeedPointsIfEmpty(db);
    }

    // Auth AVANT sync : le moteur de synchronisation envoie des mutations
    // vers Supabase — sans session restaurée, RLS refuserait chaque envoi
    // et brûlerait les tentatives de retry pour rien.
    if (!store.get("user")) {
      await initAuth();
    }
    await initSyncEngine();

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
