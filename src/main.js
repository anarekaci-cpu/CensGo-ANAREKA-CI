import "./style.css";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import L from "leaflet";
import { initAuth } from "./modules/auth/auth.js";
import { initSyncEngine } from "./modules/sync/syncEngine.js";
import { initGeolocation } from "./modules/geolocation/geolocation.js";
import { App } from "./app.js";

// Exposer Leaflet globalement pour les plugins legacy si besoin
window.L = L;

async function bootstrap() {
  const app = document.getElementById("app");

  // Écran de chargement initial
  app.innerHTML = `
    <div id="boot-screen">
      <div class="boot-spinner"></div>
      <div class="boot-text">Chargement d'ANAREKA-CI...</div>
      <div class="boot-sub">V2.0 — IndexedDB + Sync</div>
    </div>
  `;

  try {
    // 1. Initialiser la base de données locale (Dexie)
    const { db } = await import("./db/database.js");
    await db.open();
    console.log("📦 IndexedDB prête");

    // 2. Initialiser le moteur de sync
    await initSyncEngine();

    // 3. Initialiser l'auth
    await initAuth();

    // 4. Monter l'application
    const appInstance = new App(app);
    await appInstance.mount();

    // 5. Initialiser la géolocalisation
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
