import { store } from "./core/store.js";
import { initMap, fitToBounds } from "./modules/map/map.js";
import { loadCensusData } from "./modules/census/dataLoader.js";
import { renderMarkers, getFilteredBounds } from "./modules/census/markers.js";
import { initNavigation, markArrivedVisited } from "./modules/navigation/navigation.js";
import { initTour, generateOptimizedTour, startTour, goToNext, stopTour } from "./modules/tour/tour.js";
import { locateAndCenter, findNearestUnvisited } from "./modules/geolocation/geolocation.js";
import { login, logout } from "./modules/auth/auth.js";
import { resetAllVisits } from "./db/database.js";
import { askAiAgent, createSpeechRecognizer } from "./modules/ai/aiAgents.js";
import { initCensusFormModal, openCensusForm } from "./modules/census/censusFormModal.js";
import { retryFailedSyncs } from "./modules/sync/syncEngine.js";

export class App {
  constructor(container) {
    this.container = container;
    this.unsubs = [];
  }

  async mount() {
    this.unsubs.push(store.subscribe("user", () => {
      this.render();
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
              <button id="addCensusBtnHeader" class="btn-add-header" title="Nouveau point de recensement">➕ Saisie</button>
              <button id="aiModalBtnHeader" class="btn-ai-header" title="Assistant & Optimisation IA">🤖 Agents IA</button>
              <button id="logoutBtn" title="Déconnexion">🔒</button>
              <button id="menuToggleBtn" title="Filtres">☰</button>
            </div>
          </div>
        </header>

        <div id="controls">
          <div id="controlsInner">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">
              <span style="font-weight:700; font-size:14px; color:#1a3d2b; display:flex; align-items:center; gap:6px;">⚡ Options & Filtres</span>
              <button id="closeControlsBtn" style="background:#f5f5f5; border:none; width:28px; height:28px; border-radius:50%; font-size:14px; cursor:pointer; color:#666; display:flex; align-items:center; justify-content:center;">✕</button>
            </div>
            <div class="action-row" style="margin-bottom:10px; display:grid; grid-template-columns: 1fr 1.2fr; gap:8px;">
              <button id="addCensusBtnControl" class="btn-add-control">➕ Nouveau Ménage</button>
              <button id="aiModalBtnControl" class="btn-ai-control">🤖 Agents IA Copilot</button>
            </div>
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
              <label>Recherche <input type="text" id="searchBox" placeholder="Nom, quartier, tel..."></label>
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

          <!-- Modal Agents IA -->
          <div id="aiModal" class="ai-modal" style="display:none;">
            <div class="ai-modal-backdrop" id="aiModalBackdrop"></div>
            <div class="ai-modal-card">
              <div class="ai-modal-header">
                <div class="ai-modal-title">
                  <span class="ai-badge-icon">🤖</span>
                  <div>
                    <h3>Suite d'Agents IA ANAREKA-CI</h3>
                    <p>Copilot, Vision OCR, Dictée Vocale & Briefing</p>
                  </div>
                </div>
                <button id="aiModalCloseBtn" class="ai-close-btn">✕</button>
              </div>

              <div class="ai-tabs">
                <button class="ai-tab active" data-tab="copilot">💬 Copilot</button>
                <button class="ai-tab" data-tab="strategist">⚡ Strategist</button>
                <button class="ai-tab" data-tab="voice">🎙️ Dictée</button>
                <button class="ai-tab" data-tab="vision">📸 Photo OCR</button>
                <button class="ai-tab" data-tab="briefing">📊 Briefing</button>
              </div>

              <div class="ai-content-body">
                <div id="aiTabCopilot" class="ai-tab-pane active">
                  <div class="ai-prompt-box">
                    <input type="text" id="aiCopilotInput" placeholder="Posez une question sur le secteur Bingerville..." />
                    <button id="aiCopilotSendBtn" class="btn-ai-send">Envoyer</button>
                  </div>
                  <div class="ai-quick-prompts">
                    <button class="chip-prompt" data-prompt="Quelles sont les priorités de recensement ce matin ?">🎯 Priorités</button>
                    <button class="chip-prompt" data-prompt="Donne-moi une synthèse de l'avancement global du recensement.">📊 Synthèse</button>
                    <button class="chip-prompt" data-prompt="Quels sont les ménages injoignables à relancer ?">📞 Relances</button>
                  </div>
                </div>

                <div id="aiTabStrategist" class="ai-tab-pane" style="display:none;">
                  <p class="ai-pane-desc">L'Agent Strategist analyse vos points géolocalisés à Bingerville pour optimiser votre itinéraire et vos créneaux d'accès.</p>
                  <button id="aiRunStrategistBtn" class="btn-ai-action">⚡ Générer la stratégie de tournée IA</button>
                  <button id="aiRunAuditBtn" class="btn-ai-action-secondary" style="margin-top:6px;">🔍 Lancer l'audit de qualité des données</button>
                </div>

                <div id="aiTabVoice" class="ai-tab-pane" style="display:none;">
                  <p class="ai-pane-desc">Dictez votre rapport de visite à haute voix ou tapez vos notes brutes. L'Agent IA extraira automatiquement le nom, téléphone et statut.</p>
                  <div class="ai-voice-container">
                    <button id="aiMicBtn" class="btn-mic">🎙️ Démarrer la dictée vocale</button>
                    <span id="aiMicStatus" class="mic-status">Prêt</span>
                  </div>
                  <textarea id="aiVoiceNoteText" placeholder="Ou saisissez la note vocale ici (ex: Visite point 12, M. Yao Kouadio, tel 0708091011, statut vert)..." rows="3"></textarea>
                  <button id="aiParseVoiceBtn" class="btn-ai-action">✨ Analyser et structurer la note avec Gemini</button>
                </div>

                <div id="aiTabVision" class="ai-tab-pane" style="display:none;">
                  <p class="ai-pane-desc">Prenez ou téléchargez une photo du compteur d'électricité/eau ou du badge pour extraction automatique par Gemini Vision.</p>
                  <div class="ai-vision-upload">
                    <input type="file" id="aiImageInput" accept="image/*" style="display:none;" />
                    <button id="aiSelectImageBtn" class="btn-vision-select">📷 Sélectionner / Prendre une photo</button>
                    <div id="aiImagePreview" class="ai-img-preview" style="display:none;"></div>
                  </div>
                  <button id="aiRunVisionBtn" class="btn-ai-action" style="display:none; margin-top:10px;">🔍 Analyser la photo avec Gemini Vision</button>
                </div>

                <div id="aiTabBriefing" class="ai-tab-pane" style="display:none;">
                  <p class="ai-pane-desc">Obtenez un briefing IA personnalisé basé sur la météo terrain, la progression et les objectifs prioritaires.</p>
                  <button id="aiRunBriefingBtn" class="btn-ai-action">📋 Générer mon Briefing IA du Jour</button>
                </div>

                <div id="aiAgentOutput" class="ai-output-box" style="display:none;">
                  <div id="aiOutputText" class="ai-output-text"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    await this.initApp();
  }

  async initApp() {
    initMap("map");
    initNavigation();
    initTour();
    initCensusFormModal();

    const points = await loadCensusData();
    renderMarkers(points);
    this.populateBlockFilter(points);
    this.updateStats();

    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";

    document.getElementById("tourBtn").disabled = false;
    document.getElementById("nearestBtn").disabled = false;

    this.bindEvents();
    this.bindStoreListeners();
  }

  bindEvents() {
    document.getElementById("logoutBtn").onclick = () => logout();

    document.getElementById("menuToggleBtn").onclick = () => {
      document.getElementById("controls").classList.toggle("open");
    };

    const handleOpenCensus = () => {
      openCensusForm();
      this.closeControls();
    };

    document.getElementById("addCensusBtnHeader")?.addEventListener("click", handleOpenCensus);
    document.getElementById("addCensusBtnControl")?.addEventListener("click", handleOpenCensus);

    document.getElementById("closeControlsBtn")?.addEventListener("click", () => {
      this.closeControls();
    });

    document.addEventListener("click", (e) => {
      const controls = document.getElementById("controls");
      const toggleBtn = document.getElementById("menuToggleBtn");
      if (controls && controls.classList.contains("open")) {
        if (!controls.contains(e.target) && !toggleBtn.contains(e.target)) {
          this.closeControls();
        }
      }
    });

    ["filterBlock", "filterStatus", "filterVisited"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => this.applyFilters());
    });
    document.getElementById("searchBox")?.addEventListener("input", () => this.applyFilters());

    document.getElementById("locateBtn").onclick = () => {
      locateAndCenter();
      this.closeControls();
    };

    document.getElementById("nearestBtn").onclick = async () => {
      const res = await findNearestUnvisited();
      if (res) {
        const { flyToPoint } = await import("./modules/map/map.js");
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

    document.getElementById("tourBtn").onclick = async () => {
      let pos = store.get("geo.position");
      if (!pos) {
        const { getCurrentPosition } = await import("./modules/geolocation/geolocation.js");
        pos = getCurrentPosition();
        if (pos) store.set("geo.position", pos);
      }
      if (!pos) {
        alert("Position GPS indisponible pour le moment. Réessayez dans quelques secondes.");
        return;
      }
      const points = store.get("points").filter(p => !p.visited);
      const tour = generateOptimizedTour(points, { lat: pos.lat, lng: pos.lng });
      if (tour.length === 0) {
        alert("Tous les points non-visités ont déjà été traités !");
        return;
      }
      startTour(tour);
      this.closeControls();
    };

    document.getElementById("tourGoNextBtn").onclick = () => goToNext();
    document.getElementById("tourCloseBtn").onclick = () => stopTour();

    document.getElementById("exportBtn").onclick = () => this.exportCSV();

    document.getElementById("resetBtn").onclick = async () => {
      if (confirm("Réinitialiser toutes les visites enregistrées localement ?")) {
        await resetAllVisits();
        const points = await loadCensusData(true);
        renderMarkers(points);
        this.updateStats();
      }
    };

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

    this.bindAiEvents();
  }

  bindAiEvents() {
    const openModal = () => {
      document.getElementById("aiModal").style.display = "block";
      this.closeControls();
    };
    const closeModal = () => {
      document.getElementById("aiModal").style.display = "none";
    };

    document.getElementById("aiModalBtnHeader")?.addEventListener("click", openModal);
    document.getElementById("aiModalBtnControl")?.addEventListener("click", openModal);
    document.getElementById("aiModalCloseBtn")?.addEventListener("click", closeModal);
    document.getElementById("aiModalBackdrop")?.addEventListener("click", closeModal);

    const tabs = document.querySelectorAll(".ai-tab");
    tabs.forEach(t => {
      t.addEventListener("click", () => {
        tabs.forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        const tabName = t.dataset.tab;
        document.getElementById("aiTabCopilot").style.display = tabName === "copilot" ? "block" : "none";
        document.getElementById("aiTabStrategist").style.display = tabName === "strategist" ? "block" : "none";
        document.getElementById("aiTabVoice").style.display = tabName === "voice" ? "block" : "none";
        document.getElementById("aiTabVision").style.display = tabName === "vision" ? "block" : "none";
        document.getElementById("aiTabBriefing").style.display = tabName === "briefing" ? "block" : "none";
      });
    });

    const displayOutput = (html) => {
      const box = document.getElementById("aiAgentOutput");
      const text = document.getElementById("aiOutputText");
      if (box) box.style.display = "block";
      if (text) text.innerHTML = html;
    };

    const formatAiText = (str) => {
      return (str || "")
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/\n/g, '<br>');
    };

    const runCopilot = async (prompt) => {
      if (!prompt || !prompt.trim()) return;
      displayOutput("⏳ <i>L'Agent Copilot IA réfléchit...</i>");
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await askAiAgent("copilot", { prompt, points, userPos });
      displayOutput(formatAiText(res.text));
    };

    document.getElementById("aiCopilotSendBtn")?.addEventListener("click", () => {
      const input = document.getElementById("aiCopilotInput");
      if (input) {
        runCopilot(input.value);
        input.value = "";
      }
    });

    document.getElementById("aiCopilotInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const input = document.getElementById("aiCopilotInput");
        if (input) {
          runCopilot(input.value);
          input.value = "";
        }
      }
    });

    document.querySelectorAll(".chip-prompt").forEach(btn => {
      btn.addEventListener("click", () => {
        runCopilot(btn.dataset.prompt);
      });
    });

    document.getElementById("aiRunStrategistBtn")?.addEventListener("click", async () => {
      displayOutput("⏳ <i>L'Agent Strategist analyse la zone Bingerville...</i>");
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await askAiAgent("optimize_tour", { points, userPos });
      displayOutput(formatAiText(res.text));
    });

    document.getElementById("aiRunAuditBtn")?.addEventListener("click", async () => {
      displayOutput("⏳ <i>L'Agent Audit vérifie la qualité des données...</i>");
      const points = store.get("points") || [];
      const res = await askAiAgent("audit_quality", { points });
      displayOutput(formatAiText(res.text));
    });

    // --- Module 1: Dictée Vocale IA ---
    let recognizer = null;
    const micBtn = document.getElementById("aiMicBtn");
    const micStatus = document.getElementById("aiMicStatus");
    const voiceText = document.getElementById("aiVoiceNoteText");

    if (micBtn) {
      micBtn.addEventListener("click", () => {
        if (!recognizer) {
          recognizer = createSpeechRecognizer(
            (transcript) => {
              if (voiceText) voiceText.value = (voiceText.value ? voiceText.value + " " : "") + transcript;
              if (micStatus) micStatus.textContent = "✅ Transcrit !";
              if (micBtn) micBtn.classList.remove("recording");
            },
            (err) => {
              console.warn("Erreur dictée vocale:", err);
              if (micStatus) micStatus.textContent = "⚠️ Dictée vocale non disponible sur ce navigateur";
              if (micBtn) micBtn.classList.remove("recording");
            },
            () => {
              if (micBtn) micBtn.classList.remove("recording");
            }
          );
        }

        if (recognizer) {
          try {
            recognizer.start();
            if (micStatus) micStatus.textContent = "🔴 Écoute en cours... Parlez !";
            micBtn.classList.add("recording");
          } catch (e) {
            console.warn(e);
          }
        } else {
          if (micStatus) micStatus.textContent = "⚠️ Saisissez directement le texte ci-dessous.";
        }
      });
    }

    document.getElementById("aiParseVoiceBtn")?.addEventListener("click", async () => {
      const prompt = voiceText?.value;
      if (!prompt || !prompt.trim()) {
        alert("Veuillez d'abord dicter ou taper une note vocale.");
        return;
      }
      displayOutput("⏳ <i>L'Agent Transcripteur IA analyse et extrait les données...</i>");
      const res = await askAiAgent("parse_voice_note", { prompt });
      displayOutput(formatAiText(res.text));
    });

    // --- Module 2: Vision OCR Photo Compteur IA ---
    let currentImageBase64 = null;
    let currentMimeType = "image/jpeg";
    const selectImgBtn = document.getElementById("aiSelectImageBtn");
    const fileInput = document.getElementById("aiImageInput");
    const imgPreview = document.getElementById("aiImagePreview");
    const runVisionBtn = document.getElementById("aiRunVisionBtn");

    selectImgBtn?.addEventListener("click", () => fileInput?.click());

    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        currentMimeType = file.type || "image/jpeg";
        const reader = new FileReader();
        reader.onload = (evt) => {
          currentImageBase64 = evt.target.result;
          if (imgPreview) {
            imgPreview.style.display = "block";
            imgPreview.innerHTML = `<img src="${currentImageBase64}" style="max-width:100%; max-height:180px; border-radius:10px; margin-top:8px; border:1px solid #ddd;" />`;
          }
          if (runVisionBtn) runVisionBtn.style.display = "block";
        };
        reader.readAsDataURL(file);
      }
    });

    runVisionBtn?.addEventListener("click", async () => {
      if (!currentImageBase64) return;
      displayOutput("⏳ <i>L'Agent Vision Reconnaissance Gemini analyse la photo...</i>");
      const res = await askAiAgent("vision_ocr", { imageBase64: currentImageBase64, mimeType: currentMimeType });
      displayOutput(formatAiText(res.text));
    });

    // --- Module 3: Daily Briefing IA ---
    document.getElementById("aiRunBriefingBtn")?.addEventListener("click", async () => {
      displayOutput("⏳ <i>Préparation de votre Briefing IA Matinal...</i>");
      const points = store.get("points") || [];
      const res = await askAiAgent("daily_briefing", { points });
      displayOutput(formatAiText(res.text));
    });
  }

  bindStoreListeners() {
    this.unsubs.push(store.subscribe("points", () => this.updateStats()));

    const renderSyncStatus = () => {
      const el = document.getElementById("syncStatus");
      if (!el) return;
      const status = store.get("sync.status");
      const deadCount = store.get("sync.deadCount") || 0;

      if (deadCount > 0) {
        el.textContent = `⚠️ ${deadCount} fiche${deadCount > 1 ? "s" : ""} bloquée${deadCount > 1 ? "s" : ""} — Réessayer`;
        el.title = "Ces fiches n'ont pas pu être envoyées à Supabase après plusieurs tentatives. Cliquez pour réessayer.";
        el.style.cursor = "pointer";
        el.onclick = async () => {
          el.textContent = "🔄 Nouvelle tentative...";
          await retryFailedSyncs();
        };
        return;
      }

      el.onclick = null;
      el.style.cursor = "default";
      const labels = {
        idle: "🟢 Synchronisé",
        syncing: "🔄 Sync...",
        offline: "📴 Mode offline",
        error: "⚠️ Erreur sync"
      };
      el.textContent = labels[status] || status;
    };

    this.unsubs.push(store.subscribe("sync.status", renderSyncStatus));
    this.unsubs.push(store.subscribe("sync.deadCount", renderSyncStatus));

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

    this.unsubs.push(store.subscribe("tour.active", (active) => {
      const panel = document.getElementById("tourPanel");
      if (panel) panel.style.display = active ? "block" : "none";
      if (active) this.renderTourDetails();
    }));

    this.unsubs.push(store.subscribe("tour.currentIndex", () => {
      this.renderTourDetails();
    }));
  }

  renderTourDetails() {
    const points = store.get("tour.points") || [];
    const idx = store.get("tour.currentIndex") || 0;
    const progress = document.getElementById("tourProgress");
    const summary = document.getElementById("tourSummary");
    const list = document.getElementById("tourList");

    if (progress) progress.textContent = points.length ? `${idx + 1} / ${points.length} arrêts` : "0 arrêt";

    if (summary && points.length) {
      const totalKm = points.reduce((acc, p) => acc + (p.distanceFromPrev || 0), 0);
      summary.textContent = `📍 ${points.length} points non-visités — ~${totalKm < 1 ? Math.round(totalKm * 1000) + ' m' : totalKm.toFixed(1) + ' km'} au total`;
    }

    if (list && points.length) {
      list.innerHTML = points.map((p, i) => `
        <div class="tour-item ${i === idx ? 'active' : ''}" style="padding: 8px 10px; margin-bottom: 6px; border-radius: 8px; background: ${i === idx ? '#e8f5e9' : '#f9f9f9'}; border: 1px solid ${i === idx ? '#2ecc71' : '#eee'}; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <b>${i + 1}. ${p.name || 'Point ' + p.id}</b> <span style="font-size: 11px; color: #666;">(Bloc ${p.block})</span>
            <div style="font-size: 11px; color: #888;">${p.quartier || ''} — ${p.produits || ''}</div>
          </div>
          <button data-tour-index="${i}" class="tour-jump-btn" style="padding: 4px 8px; border: none; border-radius: 6px; background: #1a3d2b; color: white; font-size: 11px; cursor: pointer;">Voir</button>
        </div>
      `).join('');

      list.querySelectorAll(".tour-jump-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const targetIdx = parseInt(e.currentTarget.dataset.tourIndex, 10);
          import("./modules/tour/tour.js").then(({ goToPoint }) => {
            store.set("tour.currentIndex", targetIdx);
            goToPoint(targetIdx);
          });
        });
      });
    }
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
  }

  passesFilters(point, filters) {
    if (filters.block !== "all" && String(point.block) !== filters.block) return false;
    if (filters.status !== "all" && point.status !== filters.status) return false;
    if (filters.visited === "yes" && !point.visited) return false;
    if (filters.visited === "no" && point.visited) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${point.name || ""} ${point.quartier || ""} ${point.address || ""} ${point.tel || ""} ${point.produits || ""} ${point.id || ""} ${point.order || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
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
