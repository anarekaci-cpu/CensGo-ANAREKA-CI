import "./style.css";
// maplibre-gl.css a délibérément migré vers modules/map/map.js : ce fichier
// est importé statiquement par main.js et s'exécute AVANT la connexion, donc
// tout ce qu'il importe (y compris du CSS) alourdit le premier écran (page
// de connexion) qui n'affiche pourtant aucune carte. map.js n'est atteint
// qu'après authentification, via l'import dynamique de appView.js
// (appShell.js) — son CSS suit désormais le même découpage paresseux.

import { initAuth } from "./modules/auth/auth.js";
import { initSyncEngine } from "./modules/sync/syncEngine.js";
import { initGeolocation } from "./modules/geolocation/geolocation.js";
import { App } from "./appShell.js";
import { db } from "./db/database.js";
import { store } from "./core/store.js";
import { isDiagEnabled, diagInstallFakeUser, diagSeedPointsIfEmpty } from "./core/diagnostics.js";
import { escapeHtml } from "./core/utils.js";

async function bootstrap() {
  const app = document.getElementById("app");

  app.innerHTML = `
    <div id="boot-screen">
      <div class="boot-spinner"></div>
      <div class="boot-text">Chargement de CensGo...</div>
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
        <p>${escapeHtml(err.message || "Erreur inconnue")}</p>
        <button id="bootRetryBtn">Réessayer</button>
      </div>
    `;
    // addEventListener plutôt qu'un attribut onclick inline : le CSP
    // (script-src 'self', sans unsafe-inline) bloque silencieusement les
    // gestionnaires d'événements inline — le bouton ne faisait rien.
    document.getElementById("bootRetryBtn")?.addEventListener("click", () => {
      location.reload();
    });
  }
}

bootstrap();
