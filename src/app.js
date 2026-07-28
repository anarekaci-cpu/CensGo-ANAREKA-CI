import { store } from "./core/store.js";
import { initMap, getMap, fitToBounds } from "./modules/map/map.js";
import { loadCensusData } from "./modules/census/dataLoader.js";
import { renderMarkers, getFilteredBounds } from "./modules/census/markers.js";
import { initNavigation, markArrivedVisited } from "./modules/navigation/navigation.js";
import { initTour, generateOptimizedTour, startTour, goToNext, stopTour } from "./modules/tour/tour.js";
import { locateAndCenter, findNearestUnvisited } from "./modules/geolocation/geolocation.js";
import { login, logout, isAuthenticated } from "./modules/auth/auth.js";
import { getStats, resetAllVisits } from "./db/database.js";
import { CONFIG } from "./core/config.js";

export class App {
  constructor(container) {
    this.container = container;
    this.unsubs = [];
  }

  async mount() {
    // Écouter l'état d'authentification
    this.unsubs.push(store.subscribe("user", (user) => {
      this.render();
      if (user) this.initApp();
    }));

    this.render();
  }

  render() {
    const user = store.get("user");

    if (!user) {
      this.renderLogin();
    } else {
      this.renderApp();
    }
  }

  renderLogin() {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox">
          <div class="login-badge">🗺️</div>
          <h1>Recensement ANAREKA-CI</h1>
          <p>Connexion agent de terrain</p>
          <input type="email" id="loginEmail" placeholder="Email" autocomplete="username">
          <input type="password" id="loginPassword" placeholder="Mot de passe" autocomplete="current-password">
          <button id="loginBtn">Se connecter</button>
          <div id="loginError"></div>
        </div>
      </div>
    `;

    const btn = document.getElementById("loginBtn");
    const email = document.getElementById("loginEmail");
    const password = document.getElementById("loginPassword");
    const error = document.getElementById("loginError");

    const attempt = async () => {
      error.textContent = "";
      btn.disabled = true;
      btn.textContent = "Connexion...";
      try {
        await login(email.value.trim(), password.value);
      } catch (e) {
        error.textContent = "Email ou mot de passe incorrect.";
        btn.disabled = false;
        btn.textContent = "Se connecter";
      }
    };

    btn.onclick = attempt;
    password.onkeydown = (e) => { if (e.key === "Enter") attempt(); };
  }

  async renderApp() {
    this.container.innerHTML = `
      <div id="app-container">
        <header>
          <div class="htitle">
            <span class="brand-mark">🗺️</span>
            <div>
              <h1>Recensement <span>ANAREKA-CI</span></h1>
              <div class="stats" id="statsHeader">Chargement...</div>
            </div>
          </div>
          <div class="right">
            <div id="syncStatus">🌐 Connexion...</div>
            <div class="header-actions">
              <button id="logoutBtn" title="Déconnexion">🔒</button>
              <button id="menuToggleBtn" title="Filtres">☰</button>
            </div>
          </div>
        </header>

        <div id="controls">
          <div id="controlsInner">
            <div class="row2">
              <label>Bloc <select id="filterBlock"><option value="all">Tous</option></select></label>
              <label>Statut
                <select id="filterStatus">
                  <option value="all">Tous</option>
                  <option value="VERT (Joignable)">Vert</option>
                  <option value="JAUNE (Injoignable)">Jaune</option>
                  <option value="ROUGE (Refus)">Rouge</option>
                  <option value="VIOLET (A verifier)">Violet</option>
                  <option value="NON DEFINI">Non défini</option>
                </select>
              </label>
            </div>
            <div class="row2">
              <label>Visite
                <select id="filterVisited">
                  <option value="all">Tous</option>
                  <option value="no">Non visités</option>
                  <option value="yes">Déjà visités</option>
                </select>
              </label>
              <label>Recherche <input type="text" id="searchBox" placeholder="Nom, quartier..."></label>
            </div>
            <div class="action-row">
              <button id="locateBtn" class="btn-locate">📍 Me localiser</button>
              <button id="nearestBtn" class="btn-nearest">🏃 Plus proche</button>
            </div>
            <div class="action-row">
              <button id="tourBtn" class="btn-tour" disabled>🗺️ Tournée optimisée</button>
            </div>
            <div class="action-row">
              <button id="fitFilteredBtn" class="btn-overview">👁️ Vue d'ensemble filtrés</button>
            </div>
            <div class="action-row">
              <button id="exportBtn" class="btn-export">📄 Exporter CSV</button>
              <button id="resetBtn" class="btn-reset">🔄 Réinitialiser</button>
            </div>
            <div id="geoStatus"></div>
          </div>
        </div>

        <div id="main">
          <div id="map"></div>

          <div id="navPanel">
            <div id="navIcon">🧭</div>
            <div id="navInfo">
              <div id="navInstruction">—</div>
              <div id="navSub"></div>
            </div>
            <button id="navStopBtn">✕</button>
          </div>

          <div id="arrivalBanner">
            <div id="arrivalText">🎉 Vous êtes arrivé !</div>
            <div class="arrival-row">
              <button class="arrival-yes" id="arrivalYesBtn">✅ Marquer visité</button>
              <button class="arrival-no" id="arrivalNoBtn">Fermer</button>
            </div>
          </div>

          <div id="routeBanner">
            <span>🗺️ Itinéraire vers <b id="routeDestName"></b> — <span id="routeInfo"></span></span>
            <button id="closeRouteBtn">✕</button>
          </div>

          <button id="fabNearest">🏃 Point le plus proche</button>

          <div class="legend">
            <div><b>Statut</b></div>
            <div><span class="dot" style="background:#2ecc71"></span>Vert</div>
            <div><span class="dot" style="background:#f1c40f"></span>Jaune</div>
            <div><span class="dot" style="background:#e74c3c"></span>Rouge</div>
            <div><span class="dot" style="background:#9b59b6"></span>Violet</div>
            <div><span class="dot" style="background:#95a5a6"></span>Non défini</div>
            <div style="margin-top:5px;border-top:1px solid #ddd;padding-top:5px">
              <span style="opacity:0.5">✓</span> visité
            </div>
          </div>

          <div id="loading">Chargement de la carte...</div>

          <div id="tourPanel">
            <div class="tour-handle"></div>
            <div class="tour-header">
              <div>
                <div class="tour-title">🗺️ Tournée optimisée</div>
                <div id="tourProgress" class="tour-progress">—</div>
              </div>
              <button id="tourCloseBtn" aria-label="Fermer">✕</button>
            </div>
            <div id="tourSummary" class="tour-summary">—</div>
            <button id="tourGoNextBtn" class="tour-go-next">➡️ Naviguer vers le prochain arrêt</button>
            <div id="tourList" class="tour-list"></div>
          </div>
        </div>
      </div>
    `;

    await this.initApp();
  }

  async initApp() {
    // Initialiser la carte
    initMap("map");
    initNavigation();
    initTour();

    // Charger les données
    const points = await loadCensusData();
    renderMarkers(points);
    this.populateBlockFilter(points);
    this.updateStats();

    // Masquer le loading
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";

    // Activer les boutons
    document.getElementById("tourBtn").disabled = false;
    document.getElementById("nearestBtn").disabled = false;

    // Bind events
    this.bindEvents();
    this.bindStoreListeners();
  }

  bindEvents() {
    // Auth
    document.getElementById("logoutBtn").onclick = () => logout();

    // Controls toggle
    document.getElementById("menuToggleBtn").onclick = () => {
      document.getElementById("controls").classList.toggle("open");
    };

    // Filtres
    ["filterBlock", "filterStatus", "filterVisited"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => this.applyFilters());
    });
    document.getElementById("searchBox")?.addEventListener("input", () => this.applyFilters());

    // Actions
    document.getElementById("locateBtn").onclick = () => {
      locateAndCenter();
      this.closeControls();
    };

    document.getElementById("nearestBtn").onclick = async () => {
      const res = await findNearestUnvisited();
      if (res) {
        flyToPoint(res.point.lat, res.point.lon, 17);
        const { openPopup } = await import("./modules/census/markers.js");
        openPopup(res.point.id);
      } else {
        alert("Aucun point non-visité trouvé.");
      }
      this.closeControls();
    };

    document.getElementById("fabNearest").onclick = () => document.getElementById("nearestBtn").click();

    document.getElementById("fitFilteredBtn").onclick = () => {
      const bounds = getFilteredBounds();
      if (bounds) fitToBounds(bounds);
      else alert("Aucun point ne correspond aux filtres.");
      this.closeControls();
    };

    // Tour
    document.getElementById("tourBtn").onclick = () => {
      const pos = store.get("geo.position");
      if (!pos) {
        alert("Activez d'abord votre position (📍 Me localiser).");
        return;
      }
      const points = store.get("points").filter(p => !p.visited);
      const tour = generateOptimizedTour(points, { lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (tour.length === 0) {
        alert("Tous les points ont été visités !");
        return;
      }
      startTour(tour);
      this.closeControls();
    };

    document.getElementById("tourGoNextBtn").onclick = () => goToNext();
    document.getElementById("tourCloseBtn").onclick = () => stopTour();

    // Export CSV
    document.getElementById("exportBtn").onclick = () => this.exportCSV();

    // Reset
    document.getElementById("resetBtn").onclick = async () => {
      if (confirm("Réinitialiser toutes les visites enregistrées localement ?")) {
        await resetAllVisits();
        const points = await loadCensusData(true);
        renderMarkers(points);
        this.updateStats();
      }
    };

    // Navigation
    document.getElementById("closeRouteBtn").onclick = () => {
      store.set("navigation.active", false);
    };
    document.getElementById("navStopBtn").onclick = () => {
      store.set("navigation.active", false);
    };
    document.getElementById("arrivalYesBtn").onclick = () => markArrivedVisited();
    document.getElementById("arrivalNoBtn").onclick = () => {
      document.getElementById("arrivalBanner").style.display = "none";
    };
  }

  bindStoreListeners() {
    // Stats
    this.unsubs.push(store.subscribe("points", () => this.updateStats()));

    // Sync status
    this.unsubs.push(store.subscribe("sync.status", (status) => {
      const el = document.getElementById("syncStatus");
      if (!el) return;
      const labels = {
        idle: "🟢 Synchronisé",
        syncing: "🔄 Sync...",
        offline: "📴 Mode offline",
        error: "⚠️ Erreur sync"
      };
      el.textContent = labels[status] || status;
    }));

    // Navigation
    this.unsubs.push(store.subscribe("navigation.active", (active) => {
      const banner = document.getElementById("routeBanner");
      if (banner) banner.style.display = active ? "flex" : "none";
    }));

    this.unsubs.push(store.subscribe("navigation.instruction", (text) => {
      const el = document.getElementById("navInstruction");
      if (el) el.textContent = text || "—";
    }));

    this.unsubs.push(store.subscribe("navigation.arrived", (arrived) => {
      const banner = document.getElementById("arrivalBanner");
      if (banner) banner.style.display = arrived ? "block" : "none";
    }));

    // Tour
    this.unsubs.push(store.subscribe("tour.active", (active) => {
      const panel = document.getElementById("tourPanel");
      if (panel) panel.style.display = active ? "block" : "none";
    }));

    this.unsubs.push(store.subscribe("tour.currentIndex", (idx) => {
      const points = store.get("tour.points");
      const progress = document.getElementById("tourProgress");
      if (progress) progress.textContent = `${idx + 1} / ${points.length} arrêts`;
    }));
  }

  applyFilters() {
    const filters = {
      block: document.getElementById("filterBlock").value,
      status: document.getElementById("filterStatus").value,
      visited: document.getElementById("filterVisited").value,
      search: document.getElementById("searchBox").value.trim()
    };
    store.set("filters", filters);

    const points = store.get("points");
    const filtered = points.filter(p => this.passesFilters(p, filters));
    renderMarkers(filtered);
    this.closeControls();
  }

  passesFilters(point, filters) {
    if (filters.block !== "all" && String(point.block) !== filters.block) return false;
    if (filters.status !== "all" && point.status !== filters.status) return false;
    if (filters.visited === "yes" && !point.visited) return false;
    if (filters.visited === "no" && point.visited) return false;
    if (filters.search) {
      const hay = `${point.name || ""} ${point.quartier || ""} ${point.address || ""}`.toLowerCase();
      if (!hay.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  }

  populateBlockFilter(points) {
    const select = document.getElementById("filterBlock");
    if (!select) return;
    const blocks = [...new Set(points.map(p => p.block))].sort((a, b) => a - b);
    blocks.forEach(b => {
      const opt = document.createElement("option");
      opt.value = String(b);
      opt.textContent = `Bloc ${String(b).padStart(2, "0")}`;
      select.appendChild(opt);
    });
  }

  updateStats() {
    const points = store.get("points");
    const visited = points.filter(p => p.visited).length;
    const el = document.getElementById("statsHeader");
    if (el) el.textContent = `${visited} / ${points.length} visités`;
  }

  closeControls() {
    document.getElementById("controls")?.classList.remove("open");
  }

  exportCSV() {
    const points = store.get("points");
    const header = ["id", "block", "name", "tel", "quartier", "address", "produits", "sexe", "status", "visite", "lat", "lon"];
    const rows = points.map(p => [
      p.id, p.block, p.name, p.tel, p.quartier, p.address,
      p.produits, p.sexe, p.status, p.visited ? "oui" : "non", p.lat, p.lon
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recensement_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.closeControls();
  }
}
