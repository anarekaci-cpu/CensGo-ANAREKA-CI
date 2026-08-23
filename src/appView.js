import { store } from "./core/store.js";
import { getSupabaseClient } from "./core/supabase.js";
import { initMap, fitToBounds, flyToPoint, toggleCoverageHeatmap, updateCoverageHeatmap, getMap } from "./modules/map/map.js";
import { downloadOfflineTiles } from "./modules/map/offlineTiles.js";
import { loadCensusData } from "./modules/census/dataLoader.js";
import { renderMarkers, getFilteredBounds, openPopup } from "./modules/census/markers.js";
import { initNavigation, markArrivedVisited, setNavigationMode, recenterNavigation } from "./modules/navigation/navigation.js";
import { locateAndCenter, findNearestUnvisited, getCurrentPosition } from "./modules/geolocation/geolocation.js";
import { startAgentTracking, stopAgentTracking } from "./modules/geolocation/agentTracking.js";
import { logout } from "./modules/auth/auth.js";
import { initCensusFormModal, openCensusForm } from "./modules/census/censusFormModal.js";
import { retryFailedSyncs, dismissConflict } from "./modules/sync/syncEngine.js";
import { toastInfo, toastWarning, toastError, toastSuccess } from "./core/toast.js";
import { loadTargetZones, addTargetZone, removeTargetZone } from "./core/targetZones.js";
import { confirmAction } from "./core/confirmModal.js";
import { escapeHtml, normalizePointId } from "./core/utils.js";
import { computeStats } from "./core/analytics.js";
import { filterPoints } from "./core/filters.js";
import { lazyImport } from "./core/lazyImport.js";
import { getModeMeta } from "./modules/routing/routing.js";
import { isSpeechEnabled, setSpeechEnabled } from "./core/speech.js";
import { extractExifGps } from "./core/exif.js";
import { haversineKm } from "./core/geo.js";

// Au-delà de cette distance entre la position GPS EXIF de la photo et la
// position actuelle de l'agent, la photo envoyée à l'Agent Vision est
// probablement une ancienne photo de galerie plutôt qu'une prise fraîche
// sur le terrain — voir checkPhotoGeotag().
const PHOTO_GEOTAG_WARNING_M = 500;

let emptyStateEl = null;

function removeEmptyState() {
  if (emptyStateEl) {
    emptyStateEl.remove();
    emptyStateEl = null;
  }
}

let tourModulePromise = null;
function getTourModule() {
  if (!tourModulePromise) {
    tourModulePromise = lazyImport(() => import("./modules/tour/tour.js")).then(mod => {
      mod.initTour();
      return mod;
    });
  }
  return tourModulePromise;
}

let aiModulePromise = null;
function getAiModule() {
  if (!aiModulePromise) aiModulePromise = lazyImport(() => import("./modules/ai/aiAgents.js"));
  return aiModulePromise;
}

let compassModulePromise = null;
function getCompassModule() {
  if (!compassModulePromise) {
    compassModulePromise = lazyImport(() => import("./modules/compass/compassView.js")).then(mod => {
      mod.mountCompass();
      return mod;
    });
  }
  return compassModulePromise;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export async function mountAuthenticatedApp(container) {
  container.innerHTML = `
    <div id="app-container">
      <header>
        <div class="htitle">
          <span class="brand-mark">🗺️</span>
          <div>
            <h1>CensGo <span>ANAREKA-CI</span></h1>
            <div class="stats" id="statsHeader">Chargement...</div>
          </div>
        </div>
        <div class="right">
          <div id="syncStatus">🌐 Connexion...</div>
          <div class="header-actions">
            <button id="addCensusBtnHeader" class="btn-add-header" title="Nouveau point de recensement" aria-label="Nouveau point de recensement">➕ <span class="btn-label">Saisie</span></button>
            <button id="compassBtnHeader" class="btn-compass-header" title="Boussole terrain" aria-label="Boussole terrain">🧭 <span class="btn-label">Boussole</span></button>
            <button id="aiModalBtnHeader" class="btn-ai-header" title="Assistant & Optimisation IA" aria-label="Assistant & Optimisation IA">🤖 <span class="btn-label">Agents IA</span></button>
            <button id="menuToggleBtn" title="Filtres" aria-label="Filtres">☰</button>
          </div>
        </div>
      </header>

      <div id="controls">
        <div id="controlsInner">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">
            <span style="font-weight:700; font-size:14px; color:#1a3d2b; display:flex; align-items:center; gap:6px;">⚡ Options & Filtres</span>
            <button id="closeControlsBtn" aria-label="Fermer les filtres" style="background:#f5f5f5; border:none; width:44px; height:44px; border-radius:50%; font-size:14px; cursor:pointer; color:#666; display:flex; align-items:center; justify-content:center;">✕</button>
          </div>
          <div class="action-row" style="margin-bottom:10px; display:grid; grid-template-columns: 1fr 1.2fr; gap:8px;">
            <button id="addCensusBtnControl" class="btn-add-control">➕ Nouvel Établissement</button>
            <button id="aiModalBtnControl" class="btn-ai-control">🤖 Agents IA Copilot</button>
          </div>
          <div id="quartierCoveragePanel" style="margin:0 0 12px; padding:10px; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
            <div style="font-weight:700; font-size:12px; color:#1a3d2b; margin-bottom:6px;">📊 Couverture par quartier — priorité aux moins avancés</div>
            <div id="quartierCoverageList" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:5px;"></div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <input type="text" id="newZoneInput" placeholder="Ajouter une zone à couvrir (ville, quartier...)" style="flex:1; font-size:12px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px;" />
              <button type="button" id="addZoneBtn" style="font-size:12px; padding:6px 10px; border:none; border-radius:8px; background:#1a3d2b; color:white; cursor:pointer; white-space:nowrap;">➕ Ajouter</button>
            </div>
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
          <div id="searchResultCount" style="font-size:12px; color:#64748b; margin:-4px 0 8px; min-height:16px;"></div>
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
            <button id="heatmapBtn" class="btn-overview" style="grid-column: 1 / -1;" aria-pressed="false">🔥 Carte de densité (à visiter)</button>
          </div>
          <div class="action-row">
            <button id="offlineTilesBtn" class="btn-overview" style="grid-column: 1 / -1;" title="Télécharge les tuiles de la zone affichée pour un usage sans connexion">📥 Précharger cette zone hors-ligne</button>
          </div>
          <div class="action-row" id="adminTrackingRow" style="display:none;">
            <button id="agentTrackingBtn" class="btn-ai-control">📍 Suivi Agents Terrain</button>
          </div>
          <div class="action-row">
            <button id="exportBtn" class="btn-export" style="grid-column: 1 / -1;">📄 Exporter CSV</button>
          </div>
          <div id="geoStatus"></div>
          <div class="controls-footer">
            <button id="logoutBtn" class="btn-logout-tucked" title="Déconnexion" aria-label="Déconnexion">🚪 Déconnexion</button>
          </div>
        </div>
      </div>

      <div id="main">
        <div id="map"></div>

        <div id="navModeRow">
          <button type="button" class="nav-mode-btn" data-mode="foot" title="À pied">🚶 À pied</button>
          <button type="button" class="nav-mode-btn" data-mode="bike" title="À vélo">🚲 Vélo</button>
          <button type="button" class="nav-mode-btn" data-mode="car" title="En véhicule">🚗 Véhicule</button>
        </div>

        <div id="navPanel">
          <div id="navIcon">🚶</div>
          <div id="navInfo">
            <div id="navInstruction">—</div>
            <div id="navSub"></div>
          </div>
          <button id="navSpeechBtn" class="nav-recenter-btn" aria-label="Activer/désactiver le guidage vocal" aria-pressed="true">🔊</button>
          <button id="navRecenterBtn" class="nav-recenter-btn" aria-label="Recentrer la boussole sur ma position">🧭</button>
          <button id="navStopBtn" aria-label="Arrêter la navigation">✕</button>
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
          <button id="closeRouteBtn" aria-label="Fermer l'itinéraire">✕</button>
        </div>
        
        <button id="fabNearest">🏃 Point le plus proche</button>
        <button id="fabAdd" aria-label="Ajouter un point de recensement">➕</button>
        
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

        <div id="aiModal" class="ai-modal" role="dialog" aria-modal="true" aria-label="Assistant IA" style="display:none;">
          <div class="ai-modal-backdrop" id="aiModalBackdrop"></div>
          <div class="ai-modal-card">
            <div class="ai-modal-header">
              <div class="ai-modal-title">
                <span class="ai-badge-icon">🤖</span>
                <div>
                  <h3>Suite d'Agents IA CensGo</h3>
                  <p>Copilot, Vision OCR, Dictée Vocale & Briefing</p>
                </div>
              </div>
              <button id="aiModalCloseBtn" class="ai-close-btn" aria-label="Fermer l'assistant IA">✕</button>
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
                  <input type="text" id="aiCopilotInput" placeholder="Posez une question sur votre secteur..." />
                  <button id="aiCopilotSendBtn" class="btn-ai-send">Envoyer</button>
                </div>
                <div class="ai-quick-prompts">
                  <button class="chip-prompt" data-prompt="Quelles sont les priorités de recensement ce matin ?">🎯 Priorités</button>
                  <button class="chip-prompt" data-prompt="Donne-moi une synthèse de l'avancement global du recensement.">📊 Synthèse</button>
                  <button class="chip-prompt" data-prompt="Quels sont les ménages injoignables à relancer ?">📞 Relances</button>
                </div>
              </div>

              <div id="aiTabStrategist" class="ai-tab-pane" style="display:none;">
                <p class="ai-pane-desc">L'Agent Strategist analyse vos points géolocalisés pour optimiser votre itinéraire et vos créneaux d'accès.</p>
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

  await initApp();
}

/**
 * Fait défiler les conflits de sync (voir syncEngine.js/handleConflict)
 * un par un : ouvre la fiche concernée pour révision manuelle par l'agent
 * puis retire ce conflit de la liste. Ce n'est PAS une fusion automatique
 * — juste de quoi retrouver rapidement quelle(s) fiche(s) ont divergé
 * plutôt que de les perdre silencieusement.
 */
async function reviewNextConflict() {
  const conflicts = store.get("sync.conflicts") || [];
  const next = conflicts[0];
  if (!next) return;

  const point = (store.get("points") || []).find(p => normalizePointId(p.id) === normalizePointId(next.pointId));
  const label = point?.name || next.localPayload?.name || `#${next.pointId}`;

  toastWarning(`🔀 "${label}" a été modifiée ailleurs pendant votre édition hors-ligne. Vérifiez la fiche et corrigez si besoin.`);

  if (point) {
    flyToPoint(point.lat, point.lon, 17);
    openPopup(point.id);
  }

  await dismissConflict(next.pointId);
}

function closeControls() {
  document.getElementById("controls")?.classList.remove("open");
}

async function initApp() {
  initMap("map");
  initNavigation();
  initCensusFormModal();

  // CHARGEMENT PROGRESSIF (#26) : les listeners store sont câblés AVANT le
  // chargement des données. Dès que loadCensusData publie les points du
  // cache IndexedDB (en ~50ms), la carte, les marqueurs et les statistiques
  // s'affichent — SANS attendre la réponse Supabase qui mettra à jour
  // l'affichage en arrière-plan quand elle arrivera.
  bindEvents();
  bindStoreListeners();

  const points = await loadCensusData();

  populateBlockFilter(points);
  updateStats();
  renderQuartierCoverage();

  // Zones cibles : requête réseau non bloquante — le panneau se remplit
  // dès réception via l'abonnement "targetZones".
  loadTargetZones().then(zones => store.set("targetZones", zones))
    .catch(() => { /* table absente / hors-ligne : zones simplement vides */ });

  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";

  // Empty-state seulement si le chargement est VRAIMENT terminé sans aucun
  // point (offline, erreur, ou base vide) — pas pendant la phase "syncing"
  // où Supabase peut encore amener des données en arrière-plan.
  const syncStatus = store.get("sync.status");
  if (points.length === 0 && syncStatus !== "syncing") {
    createEmptyStateIfNeeded(points);
  } else {
    removeEmptyState();
  }

  document.getElementById("tourBtn").disabled = false;
  document.getElementById("nearestBtn").disabled = false;

  // Rôle admin : requête réseau NON bloquante (elle ne doit pas retarder
  // d'un aller-retour HTTP l'interface déjà affichée).
  refreshAdminRole();

  applyFiltersFromStore();
}

function createEmptyStateIfNeeded(points) {
  if (points.length > 0 || emptyStateEl) return;
  const mapEl = document.getElementById("main");
  if (!mapEl) return;
  emptyStateEl = document.createElement("div");
  emptyStateEl.className = "empty-state";
  emptyStateEl.innerHTML = `
    <div class="empty-state-icon">📍</div>
    <div class="empty-state-title">Aucun point de recensement</div>
    <div class="empty-state-desc">Commencez par ajouter le premier établissement de votre zone en utilisant le bouton + ci-dessus.</div>
    <button class="empty-state-btn" id="emptyAddBtn">➕ Ajouter un point</button>
  `;
  mapEl.appendChild(emptyStateEl);
  document.getElementById("emptyAddBtn")?.addEventListener("click", () => openCensusForm());
}

async function refreshAdminRole() {
  try {
    const user = store.get("user");
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    // maybeSingle() et non single() : un agent sans entrée dans user_roles
    // renvoie 0 ligne, et single() transforme ce cas NORMAL en erreur HTTP
    // 406 (bruit console + rejet de promesse). maybeSingle() renvoie null.
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const isAdmin = data?.role === "admin";
    store.set("ui.isAdmin", isAdmin);
    const adminRow = document.getElementById("adminTrackingRow");
    if (adminRow) adminRow.style.display = isAdmin ? "flex" : "none";
  } catch {
    // Table user_roles pas encore créée ou pas d'accès — mode agent
  }
}

function bindEvents() {
  document.getElementById("logoutBtn").onclick = async () => {
    const ok = await confirmAction(
      "Déconnexion",
      "Voulez-vous vous déconnecter ? Les données non synchronisées seront conservées localement."
    );
    if (ok) logout();
  };

  document.getElementById("menuToggleBtn").onclick = () => {
    document.getElementById("controls").classList.toggle("open");
  };

  const handleOpenCensus = () => {
    openCensusForm();
    closeControls();
  };

  document.getElementById("addCensusBtnHeader")?.addEventListener("click", handleOpenCensus);
  document.getElementById("addCensusBtnControl")?.addEventListener("click", handleOpenCensus);

  document.getElementById("closeControlsBtn")?.addEventListener("click", () => {
    closeControls();
  });

  document.addEventListener("click", (e) => {
    const controls = document.getElementById("controls");
    const toggleBtn = document.getElementById("menuToggleBtn");
    if (controls && controls.classList.contains("open")) {
      if (!controls.contains(e.target) && !toggleBtn.contains(e.target)) {
        closeControls();
      }
    }
  });

  ["filterBlock", "filterStatus", "filterVisited"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => applyFilters());
  });
  document.getElementById("searchBox")?.addEventListener("input", debounce(() => applyFilters(), 250));

  document.getElementById("locateBtn").onclick = () => {
    locateAndCenter();
    closeControls();
  };

  document.getElementById("nearestBtn").onclick = async () => {
    const res = await findNearestUnvisited();
    if (res) {
      flyToPoint(res.point.lat, res.point.lon, 17);
      openPopup(res.point.id);
    } else {
      toastInfo("Aucun point non-visité trouvé.");
    }
    closeControls();
  };

  document.getElementById("fabNearest").onclick = () => document.getElementById("nearestBtn").click();

  // FAB "+" : action la plus fréquente du terrain, placée en bas à droite
  // pour être atteignable du pouce en usage une main (le bouton header
  // "➕ Saisie" reste disponible mais oblige à étirer l'index).
  document.getElementById("fabAdd")?.addEventListener("click", () => {
    openCensusForm();
    closeControls();
  });

  document.getElementById("fitFilteredBtn").onclick = () => {
    const bounds = getFilteredBounds();
    if (bounds) fitToBounds(bounds);
    else toastWarning("Aucun point ne correspond aux filtres.");
    closeControls();
  };

  document.getElementById("heatmapBtn").onclick = () => {
    const btn = document.getElementById("heatmapBtn");
    const visible = toggleCoverageHeatmap(store.get("points"));
    btn.classList.toggle("active", visible);
    btn.setAttribute("aria-pressed", String(visible));
    closeControls();
  };

  document.getElementById("offlineTilesBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("offlineTilesBtn");
    const map = getMap();
    if (!map) return;

    if (!navigator.onLine) {
      toastWarning("Connexion internet requise pour précharger la carte.");
      return;
    }

    const b = map.getBounds();
    const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    // Zoom courant -> maxZoom carte : couvre la vue actuelle et le niveau de
    // détail nécessaire en navigation rapprochée, sans redescendre sur des
    // niveaux très dézoomés inutiles pour une zone déjà ciblée par l'agent.
    const baseZoom = Math.max(12, Math.floor(map.getZoom()));
    const zooms = [];
    for (let z = baseZoom; z <= 17; z++) zooms.push(z);

    const originalLabel = btn.textContent;
    btn.disabled = true;

    try {
      const result = await downloadOfflineTiles(bounds, {
        zooms,
        onProgress: (done, total) => {
          btn.textContent = `📥 ${Math.round((done / total) * 100)}%...`;
        }
      });
      toastSuccess(
        `Zone préchargée : ${result.downloaded} tuiles téléchargées` +
        (result.skippedAlreadyCached ? `, ${result.skippedAlreadyCached} déjà en cache` : "") +
        (result.failed ? `, ${result.failed} échouées` : "") + "."
      );
    } catch (err) {
      toastError(err.message || "Échec du préchargement de la zone.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  let agentTrackingActive = false;
  document.getElementById("agentTrackingBtn")?.addEventListener("click", async () => {
    agentTrackingActive = !agentTrackingActive;
    const btn = document.getElementById("agentTrackingBtn");
    if (agentTrackingActive) {
      startAgentTracking();
      if (btn) btn.textContent = "📍 Arrêter le suivi";
    } else {
      stopAgentTracking();
      if (btn) btn.textContent = "📍 Suivi Agents Terrain";
    }
    closeControls();
  });

  document.getElementById("tourBtn").onclick = async () => {
    let pos = store.get("geo.position");
    if (!pos) {
      pos = getCurrentPosition();
      if (pos) store.set("geo.position", pos);
    }
    if (!pos) {
      toastWarning("Position GPS indisponible pour le moment. Réessayez dans quelques secondes.");
      return;
    }
    const points = store.get("points").filter(p => !p.visited);
    const { generateOptimizedTour, startTour } = await getTourModule();
    const tour = generateOptimizedTour(points, { lat: pos.lat, lng: pos.lng });
    if (tour.length === 0) {
      toastInfo("Tous les points non-visités ont déjà été traités !");
      return;
    }
    startTour(tour);
    closeControls();
  };

  document.getElementById("tourGoNextBtn").onclick = async () => (await getTourModule()).goToNext();
  document.getElementById("tourCloseBtn").onclick = async () => (await getTourModule()).stopTour();

  document.getElementById("exportBtn").onclick = () => exportCSV();

  document.getElementById("addZoneBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("newZoneInput");
    const name = input?.value.trim();
    if (!name) return;
    try {
      const zone = await addTargetZone(name);
      store.set("targetZones", [...(store.get("targetZones") || []), zone]);
      renderQuartierCoverage();
      input.value = "";
      toastInfo(`"${name}" ajoutée aux zones à couvrir.`);
    } catch (err) {
      toastError(err.message || "Impossible d'ajouter cette zone.");
    }
  });
  document.getElementById("newZoneInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addZoneBtn")?.click();
  });

  document.getElementById("closeRouteBtn").onclick = () => {
    store.set("navigation.active", false);
  };
  document.getElementById("navStopBtn").onclick = () => {
    store.set("navigation.active", false);
  };
  document.getElementById("navRecenterBtn").onclick = () => {
    recenterNavigation();
  };
  const navSpeechBtn = document.getElementById("navSpeechBtn");
  if (navSpeechBtn) {
    navSpeechBtn.textContent = isSpeechEnabled() ? "🔊" : "🔇";
    navSpeechBtn.setAttribute("aria-pressed", String(isSpeechEnabled()));
    navSpeechBtn.onclick = () => {
      const next = !isSpeechEnabled();
      setSpeechEnabled(next);
      navSpeechBtn.textContent = next ? "🔊" : "🔇";
      navSpeechBtn.setAttribute("aria-pressed", String(next));
    };
  }
  document.querySelectorAll(".nav-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => setNavigationMode(btn.dataset.mode));
  });
  document.getElementById("arrivalYesBtn").onclick = () => markArrivedVisited();
  document.getElementById("arrivalNoBtn").onclick = () => {
    document.getElementById("arrivalBanner").style.display = "none";
  };

  document.getElementById("compassBtnHeader")?.addEventListener("click", async () => {
    (await getCompassModule()).openCompassPanel();
    closeControls();
  });

  bindAiEvents();
}

/**
 * Recoupe la position GPS EXIF d'une photo sélectionnée pour l'Agent
 * Vision avec la position actuelle de l'agent — avertit (sans bloquer
 * l'analyse) si elles sont éloignées, signe probable d'une photo choisie
 * dans la galerie plutôt que prise à l'instant sur le terrain.
 *
 * Best-effort à tous les niveaux : pas de position GPS actuelle, pas de
 * métadonnées EXIF sur la photo (fréquent — beaucoup d'apps photo les
 * retirent), ou erreur de lecture -> silence complet, jamais de blocage.
 */
async function checkPhotoGeotag(file) {
  try {
    const currentPos = store.get("geo.position");
    if (!currentPos) return;

    const buffer = await file.arrayBuffer();
    const gps = extractExifGps(buffer);
    if (!gps) return;

    const distKm = haversineKm(currentPos.lat, currentPos.lng, gps.lat, gps.lon);
    if (distKm * 1000 > PHOTO_GEOTAG_WARNING_M) {
      const distLabel = distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`;
      toastWarning(`📍 Cette photo a été prise à ${distLabel} de votre position actuelle — vérifiez qu'il s'agit bien d'une photo prise ici, à l'instant.`);
    }
  } catch {
    // Parsing EXIF best-effort — ne doit jamais empêcher l'analyse de la photo.
  }
}

function bindAiEvents() {
  const openModal = () => {
    document.getElementById("aiModal").style.display = "block";
    closeControls();
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');
  };

  const runCopilot = async (prompt) => {
    if (!prompt || !prompt.trim()) return;
    displayOutput("⏳ <i>L'Agent Copilot IA réfléchit...</i>");
    try {
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await (await getAiModule()).askAiAgent("copilot", { prompt, points, userPos });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Impossible de contacter l'agent IA")}</i>`);
    }
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
    displayOutput("⏳ <i>L'Agent Strategist analyse votre secteur...</i>");
    try {
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await (await getAiModule()).askAiAgent("optimize_tour", { points, userPos });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse")}</i>`);
    }
  });

  document.getElementById("aiRunAuditBtn")?.addEventListener("click", async () => {
    displayOutput("⏳ <i>L'Agent Audit vérifie la qualité des données...</i>");
    try {
      const points = store.get("points") || [];
      const res = await (await getAiModule()).askAiAgent("audit_quality", { points });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'audit")}</i>`);
    }
  });

  let recognizer = null;
  const micBtn = document.getElementById("aiMicBtn");
  const micStatus = document.getElementById("aiMicStatus");
  const voiceText = document.getElementById("aiVoiceNoteText");

  if (micBtn) {
    micBtn.addEventListener("click", async () => {
      if (!recognizer) {
        const { createSpeechRecognizer } = await getAiModule();
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
      toastWarning("Veuillez d'abord dicter ou taper une note vocale.");
      return;
    }
    displayOutput("⏳ <i>L'Agent Transcripteur IA analyse et extrait les données...</i>");
    try {
      const res = await (await getAiModule()).askAiAgent("parse_voice_note", { prompt });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse vocale")}</i>`);
    }
  });

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
          imgPreview.innerHTML = `<img src="${currentImageBase64}" alt="Aperçu de la photo sélectionnée" style="max-width:100%; max-height:180px; border-radius:10px; margin-top:8px; border:1px solid #ddd;" />`;
        }
        if (runVisionBtn) runVisionBtn.style.display = "block";
      };
      reader.readAsDataURL(file);
      checkPhotoGeotag(file);
    }
  });

  runVisionBtn?.addEventListener("click", async () => {
    if (!currentImageBase64) return;
    displayOutput("⏳ <i>L'Agent Vision Reconnaissance Gemini analyse la photo...</i>");
    try {
      const res = await (await getAiModule()).askAiAgent("vision_ocr", { imageBase64: currentImageBase64, mimeType: currentMimeType });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse photo")}</i>`);
    }
  });

  document.getElementById("aiRunBriefingBtn")?.addEventListener("click", async () => {
    displayOutput("⏳ <i>Préparation de votre Briefing IA Matinal...</i>");
    try {
      const points = store.get("points") || [];
      const res = await (await getAiModule()).askAiAgent("daily_briefing", { points });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec du briefing")}</i>`);
    }
  });
}

function bindStoreListeners() {
  store.subscribe("points", (points) => {
    updateStats();
    renderQuartierCoverage();
    populateBlockFilter(points);
    updateCoverageHeatmap(points);
    if (points && points.length > 0) {
      removeEmptyState();
      // Respecter les filtres actifs : l'arrivée de données fraîches ne doit
      // jamais faire réapparaître des points que l'agent a filtrés.
      applyFiltersFromStore();
    }
  });

  // Les zones cibles arrivent en asynchrone (loadTargetZones non bloquant).
  store.subscribe("targetZones", () => {
    renderQuartierCoverage();
  });

  const renderSyncStatus = () => {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    const status = store.get("sync.status");
    const deadCount = store.get("sync.deadCount") || 0;
    const pendingCount = store.get("sync.pendingCount") || 0;
    const conflicts = store.get("sync.conflicts") || [];

    if (deadCount > 0) {
      el.textContent = `⚠️ ${deadCount} fiche${deadCount > 1 ? "s" : ""} bloquée${deadCount > 1 ? "s" : ""} — Voir`;
      el.title = "Ces fiches n'ont pas pu être envoyées après plusieurs tentatives. Cliquez pour voir les détails.";
      el.style.cursor = "pointer";
      el.onclick = async () => {
        toastWarning(`${deadCount} fiche(s) bloquée(s). Nouvelle tentative en cours...`);
        await retryFailedSyncs();
      };
      return;
    }

    if (conflicts.length > 0) {
      el.textContent = `🔀 ${conflicts.length} conflit${conflicts.length > 1 ? "s" : ""} de sync — Voir`;
      el.title = "Ces fiches ont visiblement été modifiées ailleurs pendant que vous étiez hors-ligne. Cliquez pour les revoir une par une.";
      el.style.cursor = "pointer";
      el.onclick = () => reviewNextConflict();
      return;
    }

    el.onclick = null;
    el.style.cursor = "default";
    const labels = {
      idle: "🟢 Synchronisé",
      offline: "📴 Mode offline",
      error: "⚠️ Erreur sync"
    };
    if (status === "syncing" && pendingCount > 0) {
      el.textContent = `🔄 Sync... ${pendingCount} restante${pendingCount > 1 ? "s" : ""}`;
    } else {
      el.textContent = labels[status] || status;
    }
  };

  store.subscribe("sync.status", renderSyncStatus);
  store.subscribe("sync.deadCount", renderSyncStatus);
  store.subscribe("sync.pendingCount", renderSyncStatus);
  store.subscribe("sync.conflicts", renderSyncStatus);

  const renderGeoStatus = () => {
    const el = document.getElementById("geoStatus");
    if (!el) return;
    const error = store.get("geo.error");
    const tracking = store.get("geo.tracking");
    const position = store.get("geo.position");

    if (error) {
      el.textContent = `⚠️ ${error}`;
      el.className = "geo-status geo-status-error";
    } else if (tracking && position) {
      el.textContent = "📍 Position GPS active";
      el.className = "geo-status geo-status-ok";
    } else {
      el.textContent = "📍 Recherche de la position GPS...";
      el.className = "geo-status geo-status-pending";
    }
  };
  store.subscribe("geo.tracking", renderGeoStatus);
  store.subscribe("geo.error", renderGeoStatus);
  store.subscribe("geo.position", renderGeoStatus);
  renderGeoStatus();

  store.subscribe("navigation.active", (active) => {
    const banner = document.getElementById("routeBanner");
    if (banner) banner.style.display = active ? "flex" : "none";
    // #fabAdd occupe la même bande verticale (bottom:84) que #navPanel une
    // fois la navigation active : le bouton restait cliquable "sous" le
    // panneau, invisible mais interceptant parfois le tap. On le masque
    // pendant la navigation (ajouter un point pendant un guidage actif
    // n'est de toute façon pas le geste attendu).
    const fabAdd = document.getElementById("fabAdd");
    if (fabAdd) fabAdd.style.display = active ? "none" : "flex";
    // BUG (diagnostic itinéraire) : #navPanel contenait le texte réel de
    // l'instruction (distance/durée, erreur, "GPS indisponible"...) mais son
    // display:none initial (style.css) n'était JAMAIS levé nulle part dans le
    // code — le panneau restait invisible pour toujours, même quand la route
    // était calculée avec succès et la logique métier parfaitement correcte.
    // Aucune erreur console : juste un panneau qui ne s'ouvrait jamais.
    const panel = document.getElementById("navPanel");
    if (panel) panel.style.display = active ? "flex" : "none";
    const modeRow = document.getElementById("navModeRow");
    if (modeRow) modeRow.style.display = active ? "flex" : "none";
    if (active) renderNavModeButtons();
    const icon = document.getElementById("navIcon");
    if (icon) icon.textContent = getModeMeta(store.get("navigation.mode")).icon;
  });

  store.subscribe("navigation.mode", () => {
    renderNavModeButtons();
    const icon = document.getElementById("navIcon");
    if (icon) icon.textContent = getModeMeta(store.get("navigation.mode")).icon;
  });

  store.subscribe("navigation.destination", (destination) => {
    // BUG : #routeDestName et #routeInfo (bandeau du haut) étaient déclarés
    // dans le HTML mais jamais remplis par aucun code JS — le bandeau
    // s'affichait bien (display:flex) mais totalement vide ("Itinéraire
    // vers  — "), sans nom de destination ni info de trajet.
    const nameEl = document.getElementById("routeDestName");
    if (nameEl) nameEl.textContent = destination?.name || "";
  });

  store.subscribe("navigation.instruction", (text) => {
    const el = document.getElementById("navInstruction");
    if (el) el.textContent = text || "—";
    const infoEl = document.getElementById("routeInfo");
    if (infoEl) infoEl.textContent = text || "";
  });

  // #navSub était déclaré dans le HTML mais jamais rempli : le guidage
  // pas-à-pas (prochaine manœuvre OSRM) l'alimente maintenant.
  store.subscribe("navigation.nextInstruction", (text) => {
    const el = document.getElementById("navSub");
    if (el) el.textContent = text || "";
  });

  store.subscribe("navigation.arrived", (arrived) => {
    const banner = document.getElementById("arrivalBanner");
    if (banner) banner.style.display = arrived ? "block" : "none";
  });

  store.subscribe("tour.active", (active) => {
    const panel = document.getElementById("tourPanel");
    if (panel) panel.style.display = active ? "block" : "none";
    if (active) renderTourDetails();
  });

  store.subscribe("tour.currentIndex", () => {
    renderTourDetails();
  });
}

function renderNavModeButtons() {
  const mode = store.get("navigation.mode");
  document.querySelectorAll(".nav-mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

function renderTourDetails() {
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
    // escapeHtml obligatoire : nom/quartier/produits sont saisis par les
    // agents et affichés via innerHTML — sans échappement c'est une faille
    // XSS directe depuis n'importe quelle fiche.
    list.innerHTML = points.map((p, i) => `
      <div class="tour-item ${i === idx ? 'active' : ''}" style="padding: 8px 10px; margin-bottom: 6px; border-radius: 8px; background: ${i === idx ? '#e8f5e9' : '#f9f9f9'}; border: 1px solid ${i === idx ? '#2ecc71' : '#eee'}; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <b>${i + 1}. ${escapeHtml(p.name || 'Point ' + p.id)}</b> <span style="font-size: 11px; color: #666;">(Bloc ${String(p.block).padStart(2, "0")})</span>
          <div style="font-size: 11px; color: #888;">${escapeHtml(p.quartier || '')} — ${escapeHtml(p.produits || '')}</div>
        </div>
        <button data-tour-index="${i}" class="tour-jump-btn" style="padding: 4px 8px; border: none; border-radius: 6px; background: #1a3d2b; color: white; font-size: 11px; cursor: pointer;">Voir</button>
      </div>
    `).join('');

    list.querySelectorAll(".tour-jump-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const targetIdx = parseInt(e.currentTarget.dataset.tourIndex, 10);
        const { goToPoint } = await getTourModule();
        store.set("tour.currentIndex", targetIdx);
        goToPoint(targetIdx);
      });
    });
  }
}

// Affiche "N résultats" uniquement quand un filtre restreint réellement la
// liste (recherche texte active) — sans ça le compteur répéterait en
// permanence le total déjà visible dans l'en-tête, sans apporter d'info.
function updateSearchResultCount(search, filteredCount) {
  const el = document.getElementById("searchResultCount");
  if (!el) return;
  el.textContent = search
    ? `${filteredCount} résultat${filteredCount > 1 ? "s" : ""}`
    : "";
}

function applyFilters() {
  const filters = {
    block: document.getElementById("filterBlock").value,
    status: document.getElementById("filterStatus").value,
    visited: document.getElementById("filterVisited").value,
    search: document.getElementById("searchBox").value.trim()
  };
  store.set("filters", filters);

  // Filtre 100% LOCAL (#33) : aucune requête Supabase, on filtre les données
  // déjà en mémoire puis on met à jour les marqueurs.
  const points = store.get("points");
  const filtered = filterPoints(points, filters);
  updateSearchResultCount(filters.search, filtered.length);
  renderMarkers(filtered);
}

/**
 * Rendu des marqueurs conforme aux filtres actifs du store — utilisé par
 * l'abonnement "points" pour que l'arrivée de données fraîches (cache →
 * Supabase) ne réinitialise PAS visuellement le filtre choisi par l'agent.
 */
function applyFiltersFromStore() {
  const filters = store.get("filters") || { block: "all", status: "all", visited: "all", search: "" };
  const filtered = filterPoints(store.get("points"), filters);
  updateSearchResultCount(filters.search, filtered.length);
  renderMarkers(filtered);
}

function populateBlockFilter(points) {
  const select = document.getElementById("filterBlock");
  if (!select) return;
  const blocks = [...new Set(points.map(p => p.block))].sort((a, b) => a - b);
  const signature = blocks.join(",");
  // Idempotent : appelé à chaque arrivée de données (cache puis Supabase),
  // on ne reconstruit les options QUE si la liste des blocs a changé —
  // sinon la sélection courante de l'agent serait réinitialisée.
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const current = select.value;
  select.innerHTML = `<option value="all">Tous</option>`;
  blocks.forEach(b => {
    const opt = document.createElement("option");
    opt.value = String(b);
    opt.textContent = `Bloc ${String(b).padStart(2, "0")}`;
    select.appendChild(opt);
  });
  // Restaurer la sélection si elle existe toujours
  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

function updateStats() {
  // Source unique : computeStats() (core/analytics.js), un seul passage O(N)
  // partagé avec le panneau de couverture via le cache ci-dessous.
  const points = store.get("points");
  const targetZones = store.get("targetZones") || [];
  lastComputedStats = computeStats(points, targetZones);
  const { visited, total, coveragePct } = lastComputedStats;
  const el = document.getElementById("statsHeader");
  if (el) {
    el.innerHTML = `
      <span>${visited} / ${total} visités (${coveragePct}%)</span>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${coveragePct}%"></div>
      </div>
    `;
  }
}

// Cache du dernier calcul computeStats() : renderQuartierCoverage est appelée
// séparément (targetZones asynchrone) et ne doit PAS refaire un passage O(N).
let lastComputedStats = null;

function renderQuartierCoverage() {
  const container = document.getElementById("quartierCoverageList");
  if (!container) return;

  const targetZones = store.get("targetZones") || [];
  const stats = computeStats(store.get("points"), targetZones);
  lastComputedStats = stats;
  const rows = stats.byQuartier;
  // computeStats ne connaît pas les ids de zones : map nom -> id pour le
  // bouton de suppression des zones cibles.
  const zoneIdByName = new Map(targetZones.map(z => [z.name, z.id]));

  if (rows.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#94a3b8;">Aucune zone définie pour l'instant — ajoutez-en une ci-dessous.</div>`;
    return;
  }

  container.innerHTML = rows.map(r => {
    const color = r.total === 0 ? "#94a3b8" : r.pct < 40 ? "#e74c3c" : r.pct < 75 ? "#f1c40f" : "#2ecc71";
    const zoneId = zoneIdByName.get(r.quartier);
    const removeBtn = zoneId
      ? `<button type="button" class="remove-zone-btn" data-zone-id="${escapeHtml(zoneId)}" title="Retirer cette zone cible" aria-label="Retirer cette zone cible" style="border:none; background:none; color:#94a3b8; cursor:pointer; font-size:13px; padding:0 2px;">✕</button>`
      : "";
    return `
      <div style="display:flex; align-items:center; gap:6px; font-size:12px;">
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.quartier)}">${r.total === 0 ? "🎯 " : ""}${escapeHtml(r.quartier)}</span>
        <span style="color:#64748b; min-width:44px; text-align:right;">${r.visited}/${r.total}</span>
        <div style="width:44px; height:6px; border-radius:3px; background:#e2e8f0; overflow:hidden; flex-shrink:0;">
          <div style="height:100%; width:${r.pct}%; background:${color};"></div>
        </div>
        ${removeBtn}
      </div>
    `;
  }).join("");

  container.querySelectorAll(".remove-zone-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const zoneId = btn.dataset.zoneId;
      try {
        await removeTargetZone(zoneId);
        store.set("targetZones", (store.get("targetZones") || []).filter(z => z.id !== zoneId));
        renderQuartierCoverage();
      } catch (err) {
        toastError(err.message || "Impossible de retirer cette zone.");
      }
    });
  });
}

function exportCSV() {
  const points = store.get("points");
  const header = ["id", "block", "name", "etablissement", "activityType", "tel", "quartier", "address", "produits", "sexe", "status", "visite", "lat", "lon"];
  const rows = points.map(p => [
    p.id, p.block, p.name, p.etablissement, p.activityType, p.tel, p.quartier, p.address,
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
  closeControls();
}
