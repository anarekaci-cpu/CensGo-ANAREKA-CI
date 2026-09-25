// Gabarit HTML de l'application authentifiée (extrait de appView.js).
import { errorsSectionHtml } from "../modules/admin/errorsPanel.js";
import { ICONS, logoSvg } from "../core/icons.js";

export function appTemplate() {
  return `
    <div id="app-container">
      <header class="app-header">
        <div class="header-top">
          <div class="brand-container">
            <div class="brand-logo-wrap">
              <span class="brand-mark">${logoSvg(26)}</span>
            </div>
            <div class="brand-text">
              <span class="brand-title">CensGo</span>
              <span class="brand-tag">ANAREKA-CI</span>
            </div>
          </div>
          <div class="header-actions">
            <div id="weatherWidget" style="display:none;" title="Météo à votre position"></div>
            <button id="syncStatus" class="sync-badge-btn" type="button" aria-label="État de synchronisation">
              <span class="sync-dot"></span>
              <span class="sync-label">🌐 Connexion...</span>
            </button>
            <button id="aiModalBtnHeader" class="header-icon-btn" title="Assistant & Optimisation IA" aria-label="Assistant & Optimisation IA">🤖</button>
            <button id="themeToggleBtn" class="header-icon-btn" title="Basculer le thème clair/sombre" aria-label="Basculer le thème clair/sombre">🌙</button>
            <button id="menuToggleBtn" class="header-icon-btn" title="Filtres" aria-label="Filtres">☰</button>
            <button id="addCensusBtnHeader" style="display:none;" aria-label="Nouveau point">➕</button>
            <button id="compassBtnHeader" style="display:none;" aria-label="Boussole">🧭</button>
          </div>
        </div>

        <div class="header-zone-pill-row">
          <button id="zoneSelectorPill" class="zone-pill-btn" type="button" title="Aller au point non-visité le plus proche">
            <span class="zone-icon">${ICONS.nearest}</span>
            <span id="selectedZoneLabel" class="zone-name">Point le plus proche</span>
          </button>
          <div class="stats" id="statsHeader">Chargement...</div>
          <span id="agentNumberBadge" class="pending-approval-badge" style="display:none;"></span>
        </div>
      </header>

      <div id="controls">
        <div id="controlsInner">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);">
            <span style="font-weight:700; font-size:14px; color:var(--green-dark); display:flex; align-items:center; gap:6px;">⚡ Options & Filtres</span>
            <button id="closeControlsBtn" aria-label="Fermer les filtres" style="background:var(--bg-surface); border:none; width:44px; height:44px; border-radius:50%; font-size:14px; cursor:pointer; color:var(--text-secondary); display:flex; align-items:center; justify-content:center;">✕</button>
          </div>
          <div class="action-row" style="margin-bottom:10px; display:grid; grid-template-columns: 1fr 1.2fr; gap:8px;">
            <button id="addCensusBtnControl" class="btn-add-control">➕ Nouvel Établissement</button>
            <button id="aiModalBtnControl" class="btn-ai-control">🤖 Agents IA Copilot</button>
          </div>
          <div id="quartierCoveragePanel" style="margin:0 0 12px; padding:10px; background:var(--bg-surface); border-radius:10px; border:1px solid var(--border);">
            <div style="font-weight:700; font-size:12px; color:var(--green-dark); margin-bottom:6px;">📊 Couverture par quartier — priorité aux moins avancés</div>
            <div id="quartierCoverageList" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:5px;"></div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <input type="text" id="newZoneInput" placeholder="Ajouter une zone à couvrir (ville, quartier...)" style="flex:1; font-size:12px; padding:6px 8px; border:1px solid var(--border); border-radius:8px; background:var(--bg-card); color:var(--text-primary);" />
              <button type="button" id="addZoneBtn" style="font-size:12px; padding:6px 10px; border:none; border-radius:8px; background:var(--green-dark); color:var(--bg-card); cursor:pointer; white-space:nowrap;">➕ Ajouter</button>
            </div>
          </div>
          <div class="row2">
            <label>Ville <select id="filterCity"><option value="all">Toutes</option></select></label>
            <label>Quartier <select id="filterQuartier"><option value="all">Tous</option></select></label>
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
          <label>Visite
            <select id="filterVisited">
              <option value="all">Tous</option>
              <option value="no">Non visités</option>
              <option value="yes">Déjà visités</option>
            </select>
          </label>
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
            <button id="manageAgentsBtn" class="btn-ai-control">👥 Comptes agents</button>
          </div>
          <div class="action-row" id="followUpRow" style="display:none;">
            <button id="followUpBtn" class="btn-ai-control" style="grid-column: 1 / -1;">📞 Appels de suivi</button>
          </div>
          <div class="action-row" id="exportRow" style="display:none;">
            <button id="exportBtn" class="btn-export" style="grid-column: 1 / -1;">📄 Exporter CSV</button>
            <div id="exportQualitySummary" class="export-quality-summary" hidden role="status"></div>
          </div>
          <div class="action-row" id="tourReportRow" style="display:none;">
            <button id="tourReportBtn" class="btn-export" style="grid-column: 1 / -1;">🖨️ Rapport PDF de la dernière tournée</button>
          </div>
          <div class="action-row">
            <button id="gpsPowerBtn" class="btn-overview" type="button" style="grid-column: 1 / -1;" title="Ajuste la fréquence de rafraîchissement GPS selon le niveau de batterie et l'immobilité, pour économiser l'autonomie sur une longue journée terrain">🔋 GPS : auto</button>
          </div>
          <div id="geoStatus"></div>
          <div class="controls-footer">
            <button id="logoutBtn" class="btn-logout-tucked" title="Déconnexion" aria-label="Déconnexion">🚪 Déconnexion</button>
          </div>
        </div>
      </div>

      <div id="main">
        <div id="map"></div>

        <div class="map-floating-controls-top">
          <button id="floatingLocateBtn" class="fab-map-control" title="Me géolocaliser" aria-label="Me géolocaliser">${ICONS.locate}</button>
        </div>

        <div class="map-floating-controls-bottom">
          <button id="zoomInBtn" class="fab-map-zoom" title="Zoomer" aria-label="Zoomer">+</button>
          <button id="zoomOutBtn" class="fab-map-zoom" title="Dézoomer" aria-label="Dézoomer">−</button>
        </div>

        <!-- Model 1: Merchant Bottom Sheet -->
        <div id="merchantBottomSheet" class="merchant-bottom-sheet" aria-hidden="true">
          <div class="sheet-drag-handle" id="sheetDragHandle">
            <span class="handle-bar"></span>
          </div>
          <button id="closeSheetBtn" class="sheet-close-btn" aria-label="Fermer la fiche">✕</button>
          
          <div class="sheet-content">
            <div class="sheet-header">
              <div class="sheet-title-row">
                <h2 id="sheetMerchantName" class="sheet-merchant-name">Établissement</h2>
                <span id="sheetStatusBadge" class="sheet-status-badge">🟢 Vert</span>
              </div>
              <div class="sheet-sub-row">
                <span id="sheetRating" class="sheet-rating">⭐ Référencé</span>
                <span id="sheetDistance" class="sheet-distance"></span>
              </div>
            </div>

            <div class="sheet-body">
              <div class="sheet-info-item">
                <span class="info-icon">👤</span>
                <span id="sheetOwner" class="info-text">—</span>
              </div>
              <div class="sheet-info-item">
                <span class="info-icon">📍</span>
                <span id="sheetAddress" class="info-text">—</span>
              </div>
              <div class="sheet-info-item">
                <span class="info-icon">🏷️</span>
                <span id="sheetActivityTag" class="info-text tag-pill">Restauration</span>
              </div>
              <div class="sheet-info-item" id="sheetTelRow" style="display:none;">
                <span class="info-icon">📞</span>
                <a id="sheetTelLink" href="tel:" class="info-tel-link">—</a>
              </div>
            </div>

            <div class="sheet-actions-row">
              <button id="sheetActionPrimary" class="btn-sheet-primary">➕ Recenser</button>
              <button id="sheetActionRoute" class="btn-sheet-secondary">🧭 Itinéraire</button>
              <button id="sheetActionVisit" class="btn-sheet-secondary">✅ Visité</button>
              <button id="sheetActionEdit" class="btn-sheet-icon" title="Modifier">✏️</button>
            </div>

            <div class="sheet-status-pills">
              <span id="sheetGpsStatusPill" class="status-pill">
                <span class="status-dot green"></span>
                <span id="sheetGpsText">GPS: Stable</span>
              </span>
              <span id="sheetOfflineStatusPill" class="status-pill">
                <span class="status-dot green"></span>
                <span id="sheetSyncText">Mode Hors ligne • Synch. ✓</span>
              </span>
            </div>
          </div>
        </div>

        <div id="navBottomStack">
          <div id="navModeRow">
            <button type="button" class="nav-mode-btn" data-mode="foot" title="À pied">🚶 À pied</button>
            <button type="button" class="nav-mode-btn" data-mode="bike" title="À vélo">🚲 Vélo</button>
            <button type="button" class="nav-mode-btn" data-mode="car" title="En véhicule">🚗 Véhicule</button>
          </div>

          <div id="navPanel">
            <button id="navCollapseBtn" class="nav-collapse-btn" type="button" tabindex="0" aria-label="Réduire le panneau de navigation" aria-expanded="true">⌄</button>
            <div id="navIcon">🚶</div>
            <div id="navInfo">
              <div id="navInstruction">—</div>
              <div id="navSub"></div>
            </div>
            <button id="navSpeechBtn" class="nav-recenter-btn" aria-label="Activer/désactiver le guidage vocal" aria-pressed="true">🔊</button>
            <button id="navRecenterBtn" class="nav-recenter-btn" aria-label="Recentrer la boussole sur ma position">🧭</button>
            <button id="navStopBtn" aria-label="Arrêter la navigation">✕</button>
          </div>
        </div>
        
        <div id="arrivalBanner">
          <div id="arrivalText">🎉 Vous êtes arrivé !</div>
          <div class="arrival-row">
            <button class="arrival-yes" id="arrivalYesBtn">✅ Marquer visité</button>
            <button class="arrival-no" id="arrivalNoBtn">Fermer</button>
          </div>
        </div>
        
        <div id="routeBanner">
          <span>🗺️ Itinéraire vers <b id="routeDestName"></b> — <span id="routeInfo"></span> <small id="routeChoiceLabel"></small></span>
          <button id="routeChoiceBtn" type="button" class="route-choice-btn" style="display:none;">Changer</button>
          <button id="closeRouteBtn" aria-label="Fermer l'itinéraire">✕</button>
        </div>

        <!-- HUD de guidage flottant (turn-by-turn) : prochaine manœuvre en
             évidence + distance restante / temps estimé. Complète le panneau
             bas (#navPanel) qui garde les contrôles (voix, recentrer, stop). -->
        <div id="navHud" class="navigation-hud" hidden aria-live="polite" aria-atomic="true">
          <div class="hud-mode" id="hudModeIcon" aria-hidden="true">🚶</div>
          <div class="hud-text">
            <div class="hud-maneuver" id="hudManeuver">—</div>
            <div class="hud-meta" id="hudMeta"></div>
          </div>
        </div>
        
        <button id="fabNearest" style="display:none;">🏃 Point le plus proche</button>
        <button id="fabAdd" style="display:none;" aria-label="Ajouter un point de recensement">➕</button>
        
        <details class="legend" id="mapLegend">
          <summary>Légende</summary>
          <div><span class="dot" style="background:#2ecc71"></span>Vert</div>
          <div><span class="dot" style="background:#f1c40f"></span>Jaune</div>
          <div><span class="dot" style="background:#e74c3c"></span>Rouge</div>
          <div><span class="dot" style="background:#9b59b6"></span>Violet</div>
          <div><span class="dot" style="background:#95a5a6"></span>Non défini</div>
          <div class="legend-visited"><span style="opacity:0.5">✓</span> visité</div>
        </details>
        
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

        <div id="agentsModal" class="ai-modal" role="dialog" aria-modal="true" aria-label="Comptes agents" style="display:none;">
          <div class="ai-modal-backdrop" id="agentsModalBackdrop"></div>
          <div class="ai-modal-card">
            <div class="ai-modal-header">
              <div class="ai-modal-title">
                <span class="ai-badge-icon">👥</span>
                <div>
                  <h3>Comptes agents</h3>
                  <p>Validez un compte pour lui donner accès à la carte</p>
                </div>
              </div>
              <button id="agentsModalCloseBtn" class="ai-close-btn" aria-label="Fermer">✕</button>
            </div>
            <div class="ai-content-body">
              <div id="agentsSummary" class="agents-summary"></div>
              <div id="agentsList" class="agents-list"></div>

              <div class="agents-cities-section">
                <h4>🏙️ Villes du recensement</h4>
                <p class="input-hint">Liste fermée : seul un admin peut ajouter/retirer une ville. Elle alimente le champ "Ville" du formulaire de recensement pour tous les agents.</p>
                <div id="citiesList" class="cities-list"></div>
                <div class="add-city-row">
                  <input type="text" id="newCityInput" placeholder="Ex: Cocody" autocomplete="off" />
                  <button id="addCityBtn" class="btn-secondary" type="button">Ajouter</button>
                </div>
              </div>

              <div class="agents-cities-section">
                <h4>🎟️ Liens d'invitation</h4>
                <p class="input-hint">Un agent qui s'inscrit via ce lien est approuvé automatiquement — pratique pour recruter plusieurs agents d'un coup sans validation manuelle. Toujours limité au rôle "agent" (jamais admin).</p>
                <div id="invitesList" class="invites-list"></div>
                <div class="new-invite-form">
                  <input type="text" id="newInviteLabel" placeholder="Étiquette (ex: Recrutement Cocody)" autocomplete="off" />
                  <div class="new-invite-row">
                    <label>Usages max <input type="number" id="newInviteMaxUses" value="20" min="1" style="width:70px;" /></label>
                    <label>Expire (jours) <input type="number" id="newInviteExpiresDays" value="30" min="1" style="width:70px;" /></label>
                    <button id="createInviteBtn" class="btn-secondary" type="button">Générer un lien</button>
                  </div>
                </div>
              </div>
              ${errorsSectionHtml()}
            </div>
          </div>
        </div>

        <div id="agentReportModal" class="ai-modal" role="dialog" aria-modal="true" aria-label="Fiches recensées par agent" style="display:none;">
          <div class="ai-modal-backdrop" id="agentReportModalBackdrop"></div>
          <div class="ai-modal-card">
            <div class="ai-modal-header">
              <div class="ai-modal-title">
                <span class="ai-badge-icon">📋</span>
                <div>
                  <h3 id="agentReportTitle">Fiches recensées</h3>
                  <p>Pour le calcul de la paie — période au choix</p>
                </div>
              </div>
              <button id="agentReportCloseBtn" class="ai-close-btn" aria-label="Fermer">✕</button>
            </div>
            <div class="ai-content-body">
              <div class="segmented-control" id="agentReportPeriodGroup" role="group" aria-label="Période">
                <button type="button" class="segment-btn" data-period="day">Aujourd'hui</button>
                <button type="button" class="segment-btn" data-period="week">Cette semaine</button>
                <button type="button" class="segment-btn" data-period="month">Ce mois</button>
                <button type="button" class="segment-btn active" data-period="all">Tout</button>
              </div>
              <div id="agentReportSummary" class="agents-summary"></div>
              <div id="agentReportTable" class="agent-report-table"></div>
              <div class="agent-report-export-row">
                <button id="agentReportExportBtn" type="button" class="btn-secondary">⬇️ CSV</button>
                <button id="agentReportPdfBtn" type="button" class="btn-secondary">🖨️ PDF</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Appels de suivi (demande explicite) : le recensement terrain
             (agent) n'attribue plus lui-même Vert/Jaune/Rouge/Violet — ce
             statut reflète l'appel de vérification que l'ADMINISTRATION
             fait APRÈS coup pour confirmer que la personne recensée a bien
             reçu l'information et savoir si elle est joignable/dispo. Tant
             qu'aucun appel n'a eu lieu, un point reste "NON DEFINI" (déjà
             la valeur par défaut à la création, voir censusFormModal.js) —
             cette liste montre donc exactement "qui reste à appeler",
             triée du plus récemment recensé au plus ancien pour faire
             remonter naturellement les nouvelles fiches en premier. -->
        <div id="followUpModal" class="ai-modal" role="dialog" aria-modal="true" aria-label="Appels de suivi" style="display:none;">
          <div class="ai-modal-backdrop" id="followUpModalBackdrop"></div>
          <div class="ai-modal-card">
            <div class="ai-modal-header">
              <div class="ai-modal-title">
                <span class="ai-badge-icon">📞</span>
                <div>
                  <h3>Appels de suivi</h3>
                  <p>Fiches recensées, pas encore vérifiées par appel</p>
                </div>
              </div>
              <button id="followUpModalCloseBtn" class="ai-close-btn" aria-label="Fermer">✕</button>
            </div>
            <div class="ai-content-body">
              <div id="followUpSummary" class="agents-summary"></div>
              <div id="followUpList" class="agents-list"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Model 1: Bottom Navigation Bar -->
      <nav id="bottomNavBar" class="bottom-nav-bar" aria-label="Navigation principale">
        <button id="navTabMap" class="nav-tab active" data-tab="map" aria-label="Carte">
          <div class="tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
              <line x1="8" y1="2" x2="8" y2="18"></line>
              <line x1="16" y1="6" x2="16" y2="22"></line>
            </svg>
          </div>
          <span class="tab-label">Carte</span>
        </button>

        <button id="navTabTasks" class="nav-tab" data-tab="tasks" aria-label="Tâches et tournée">
          <div class="tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11l3 3L22 4"></path>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          </div>
          <span class="tab-label">Tâches</span>
        </button>

        <button id="navTabFabAdd" class="nav-tab-fab" title="Nouveau Recensement" aria-label="Nouveau Recensement">
          <div class="fab-circle">
            ${ICONS.plus}
          </div>
        </button>

        <button id="navTabReports" class="nav-tab" data-tab="reports" aria-label="Rapports et analyses">
          <div class="tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </div>
          <span class="tab-label">Rapports</span>
        </button>

        <button id="navTabProfile" class="nav-tab" data-tab="profile" aria-label="Profil et options">
          <div class="tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <span class="tab-label">Profil</span>
        </button>
      </nav>
    </div>
  `;
}
