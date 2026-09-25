import { store } from "./core/store.js";
import { appTemplate } from "./views/appTemplate.js";
import { closeControls } from "./views/uiHelpers.js";
import { bindAiEvents } from "./views/aiPanel.js";
import { bindAgentsModalEvents, openAgentsModal, renderAgentReport, renderCitiesList, setAgentReportTarget } from "./views/adminPanel.js";
import { applyFilters, applyFiltersFromStore, populateBlockFilter, populateCityFilter, populateQuartierFilter, renderQuartierCoverage, updateStats } from "./views/filtersView.js";
import { exportCSV, generateTourReport } from "./views/exports.js";
import { ICONS } from "./core/icons.js";
import { CONFIG } from "./core/config.js";
import { canMarkVisited } from "./core/geofence.js";
import { updatePointVisit } from "./db/database.js";
import { getSupabaseClient } from "./core/supabase.js";
import { initMap, fitToBounds, flyToPoint, toggleCoverageHeatmap, updateCoverageHeatmap, getMap, setMapTheme } from "./modules/map/map.js";
import { downloadOfflineTiles } from "./modules/map/offlineTiles.js";
import { loadCensusData, refreshPointsInBounds } from "./modules/census/dataLoader.js";
import { getFilteredBounds, openPopup } from "./modules/census/markers.js";
import { initNavigation, markArrivedVisited, setNavigationMode, recenterNavigation, chooseRouteAlternative } from "./modules/navigation/navigation.js";
import { initHazards } from "./modules/hazards/hazards.js";
import { locateAndCenter, findNearestUnvisited, getCurrentPosition, stopGeolocation, cycleGpsPowerMode } from "./modules/geolocation/geolocation.js";
import { startAgentTracking, stopAgentTracking } from "./modules/geolocation/agentTracking.js";
import { logout } from "./modules/auth/auth.js";
import { initCensusFormModal, openCensusForm } from "./modules/census/censusFormModal.js";
import { retryFailedSyncs, dismissConflict, triggerPhotoUpload, triggerSheetsSync } from "./modules/sync/syncEngine.js";
import { toastInfo, toastWarning, toastError, toastSuccess } from "./core/toast.js";
import { loadTargetZones, addTargetZone } from "./core/targetZones.js";
import { loadCities, getCachedCities } from "./core/cities.js";

import { loadTourSessions } from "./core/tourSessions.js";
import { confirmAction } from "./core/confirmModal.js";
import { escapeHtml, normalizePointId, debounce } from "./core/utils.js";

import { filterPoints } from "./core/filters.js";
import { computeTourAsync } from "./core/computeClient.js";
import { lazyImport } from "./core/lazyImport.js";
import { getModeMeta } from "./modules/routing/routing.js";
import { isSpeechEnabled, setSpeechEnabled } from "./core/speech.js";

import { getWeather, getRainAlert, describeWeatherCode } from "./modules/weather/weather.js";
import { getEffectiveTheme, toggleTheme } from "./core/theme.js";

import { retryDeadPhotos, retryDeadSheetsSyncs } from "./db/database.js";

import { buildPopupModel } from "./modules/census/popupModel.js";

// Au-delà de cette distance entre la position GPS EXIF de la photo et la
// position actuelle de l'agent, la photo envoyée à l'Agent Vision est
// probablement une ancienne photo de galerie plutôt qu'une prise fraîche
// sur le terrain — voir checkPhotoGeotag().

let emptyStateEl = null;
let routeBannerCollapseTimer = null;
let agentTrackingActive = false;
// BUG corrigé (audit) : initApp() est rappelée à chaque reconnexion dans la
// même session (logout -> login sans recharger la page, appShell.js remet
// _appMounted à false). document.addEventListener() et store.subscribe()
// SURVIVENT au remontage (document et le store sont des singletons module,
// contrairement aux éléments du container dont l'innerHTML est reconstruit
// à chaque montage) — sans garde, chaque reconnexion ajoutait un handler
// "clic extérieur" ET dupliquait tous les abonnements de bindStoreListeners()
// (un de plus par login, jamais nettoyé), déclenchant les mêmes mises à jour
// DOM N fois pour N connexions. Plausible sur une tablette de terrain
// partagée entre plusieurs agents qui se (dé)connectent à tour de rôle.
let appEventsInitialized = false;

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

export async function mountAuthenticatedApp(container) {
  container.innerHTML = appTemplate();
  // Légende repliée par défaut sur mobile (elle masquait la carte et les
  // boutons flottants), dépliée d'office sur tablette/ordinateur.
  if (window.matchMedia?.("(min-width: 768px)").matches) {
    document.getElementById("mapLegend")?.setAttribute("open", "");
  }

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

// Rafraîchie toutes les 30 minutes (alignée sur le TTL du cache météo, voir
// modules/weather/weather.js) plutôt qu'à chaque mise à jour GPS — la météo
// ne justifie pas un appel réseau à chaque déplacement de l'agent.
let weatherIntervalId = null;

async function refreshWeatherWidget() {
  const el = document.getElementById("weatherWidget");
  if (!el) return;

  const pos = store.get("geo.position") || getCurrentPosition();
  if (!pos) {
    el.style.display = "none";
    return;
  }

  try {
    const weather = await getWeather(pos.lat, pos.lng);
    const { icon, label } = describeWeatherCode(weather.current.weatherCode);
    const temp = Number.isFinite(weather.current.temperatureC) ? `${Math.round(weather.current.temperatureC)}°C` : "";
    el.style.display = "";
    el.innerHTML = `<span aria-hidden="true">${icon}</span><span>${temp}</span>`;
    el.title = `${label}${temp ? " — " + temp : ""}${weather.stale ? " (dernière donnée connue, hors-ligne)" : ""}`;
  } catch {
    // Ni réseau ni cache disponible : widget simplement masqué, pas d'erreur UI.
    el.style.display = "none";
  }
}

let weatherPositionUnsub = null;

function startWeatherRefreshLoop() {
  // Réentrance possible (reconnexion sans recharger la page, voir
  // appEventsInitialized) : on repart d'un intervalle propre à chaque fois
  // plutôt que d'en empiler un par connexion.
  if (weatherIntervalId) clearInterval(weatherIntervalId);
  if (weatherPositionUnsub) weatherPositionUnsub();

  refreshWeatherWidget();
  weatherIntervalId = setInterval(refreshWeatherWidget, 30 * 60 * 1000);

  // Premier appel ci-dessus presque toujours SANS position : watchPosition()
  // (geolocation.js) est asynchrone et son premier fix arrive après le
  // montage — sans ce complément, le widget restait caché jusqu'au prochain
  // rafraîchissement périodique (jusqu'à 30 min) même si une position
  // devenait disponible quelques secondes plus tard. Un seul rattrapage
  // suffit : les rafraîchissements suivants sont couverts par l'intervalle.
  let weatherFetchedOnce = false;
  weatherPositionUnsub = store.subscribe("geo.position", (pos) => {
    if (pos && !weatherFetchedOnce) {
      weatherFetchedOnce = true;
      refreshWeatherWidget();
    }
  });
}

// Le bandeau (.app-header) flotte maintenant AU-DESSUS de la carte
// (position:absolute, voir style.css) au lieu de la repousser vers le bas —
// sa hauteur réelle varie (météo/badge d'agents qui apparaissent de façon
// asynchrone, largeur de viewport qui fait retomber la barre de recherche
// sur 2 lignes...), donc figée en dur elle finirait décalée. --header-h est
// donc mesurée en direct et republiée à chaque changement de taille du
// bandeau — tout élément à l'intérieur de #main qui doit se caler juste en
// dessous (routeBanner, arrivalBanner, contrôles flottants du haut de
// carte) l'utilise via calc(var(--header-h) + Npx) plutôt qu'un décalage
// figé qui supposerait un header "en flux".
function observeHeaderHeight() {
  const headerEl = document.querySelector(".app-header");
  if (!headerEl) return;
  const setHeaderHeight = () => {
    document.documentElement.style.setProperty("--header-h", `${headerEl.offsetHeight}px`);
  };
  setHeaderHeight();
  if ("ResizeObserver" in window) {
    new ResizeObserver(setHeaderHeight).observe(headerEl);
  } else {
    window.addEventListener("resize", setHeaderHeight);
  }
}

async function initApp() {
  observeHeaderHeight();
  initMap("map");
  initNavigation();
  initHazards();
  initCensusFormModal();

  // CHARGEMENT PROGRESSIF (#26) : les listeners store sont câblés AVANT le
  // chargement des données. Dès que loadCensusData publie les points du
  // cache IndexedDB (en ~50ms), la carte, les marqueurs et les statistiques
  // s'affichent — SANS attendre la réponse Supabase qui mettra à jour
  // l'affichage en arrière-plan quand elle arrivera.
  bindEvents();
  // store.subscribe() survit aux remontages (le store est un singleton
  // module) — voir la déclaration d'appEventsInitialized. Rebinder ici à
  // chaque reconnexion dupliquerait indéfiniment les abonnements.
  if (!appEventsInitialized) bindStoreListeners();
  appEventsInitialized = true;

  const points = await loadCensusData();

  // Chargement spatial par emprise (opt-in VITE_ENABLE_BBOX_LOADING) : sur un
  // très gros recensement, rafraîchit le détail de la seule zone regardée
  // quand l'agent déplace la carte. No-op (et sans coût) si le flag est off.
  if (CONFIG.ENABLE_BBOX_LOADING) {
    const map = getMap();
    if (map) {
      const onViewportChange = debounce(() => {
        const b = map.getBounds();
        refreshPointsInBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      }, 500);
      map.on("moveend", onViewportChange);
      onViewportChange();
    }
  }

  populateBlockFilter(points);
  populateQuartierFilter(points);
  updateStats();
  renderQuartierCoverage();

  // Zones cibles : requête réseau non bloquante — le panneau se remplit
  // dès réception via l'abonnement "targetZones".
  loadTargetZones().then(zones => store.set("targetZones", zones))
    .catch((err) => {
      // Échec attendu (table absente / hors-ligne) : le panneau reste
      // simplement vide, pas d'erreur UI. Mais un échec INATTENDU (policy
      // RLS cassée, etc.) ne doit pas disparaître sans trace — voir le
      // correctif équivalent pour refreshAdminRole() ci-dessous.
      console.warn("Zones cibles : chargement échoué —", err?.message || err);
    });

  // Villes : liste fermée gérée par l'admin (voir supabase/add_cities.sql) —
  // alimente le select "Ville" du formulaire de recensement dès réception.
  // Affichage immédiat depuis le cache local, rafraîchi dès que le réseau répond.
  if (!(store.get("cities") || []).length) store.set("cities", getCachedCities());
  loadCities().then(cities => {
    store.set("cities", cities);
    populateCityFilter(cities);
  }).catch((err) => {
    console.warn("Villes : chargement échoué —", err?.message || err);
  });

  // Historique des tournées (kilomètres parcourus, rapport de paie) —
  // non bloquant, seulement consulté à l'ouverture du rapport agent.
  loadTourSessions().then(sessions => store.set("tourSessions", sessions))
    .catch((err) => {
      console.warn("Historique des tournées : chargement échoué —", err?.message || err);
    });

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

  startWeatherRefreshLoop();

  // Rôle admin : requête réseau NON bloquante (elle ne doit pas retarder
  // d'un aller-retour HTTP l'interface déjà affichée).
  refreshAdminRole();

  applyFiltersFromStore();
}

// Le "vide" a deux causes très différentes : soit aucun point n'a encore
// été recensé, soit (compte fraîchement inscrit) le serveur bloque
// délibérément la lecture tant qu'un admin n'a pas validé le rôle — voir
// refreshAdminRole()/ui.pendingApproval. Sans ce message dédié, un agent en
// attente lirait "commencez par ajouter le premier établissement" (bouton
// qui échouerait de toute façon côté RLS) et croirait à un bug plutôt qu'à
// une étape normale d'inscription.
function emptyStateHTML() {
  if (store.get("ui.pendingApproval")) {
    const num = store.get("ui.agentNumber");
    return `
      <div class="empty-state-icon">⏳</div>
      <div class="empty-state-title">Compte en attente de validation</div>
      <div class="empty-state-desc">${num != null ? `Vous êtes <b>Agent #${escapeHtml(String(num))}</b>. ` : ""}Un administrateur doit valider votre compte avant que vous puissiez voir et saisir des points de recensement.</div>
    `;
  }
  return `
    <div class="empty-state-icon">📍</div>
    <div class="empty-state-title">Aucun point de recensement</div>
    <div class="empty-state-desc">Commencez par ajouter le premier établissement de votre zone en utilisant le bouton + ci-dessus.</div>
    <button class="empty-state-btn" id="emptyAddBtn">➕ Ajouter un point</button>
  `;
}

function createEmptyStateIfNeeded(points) {
  if (points.length > 0 || emptyStateEl) return;
  const mapEl = document.getElementById("main");
  if (!mapEl) return;
  emptyStateEl = document.createElement("div");
  emptyStateEl.className = "empty-state";
  emptyStateEl.innerHTML = emptyStateHTML();
  mapEl.appendChild(emptyStateEl);
  document.getElementById("emptyAddBtn")?.addEventListener("click", () => openCensusForm());
}

// refreshAdminRole() résout ui.pendingApproval de façon asynchrone, APRÈS
// le premier rendu de l'état vide (qui ne connaît pas encore la réponse) —
// on met à jour son contenu une fois la réponse serveur connue.
function refreshEmptyStateContent() {
  if (!emptyStateEl) return;
  emptyStateEl.innerHTML = emptyStateHTML();
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
    const { data, error } = await supabase
      .from("user_roles")
      .select("role, full_name, agent_number")
      .eq("user_id", user.id)
      .maybeSingle();
    // BUG (diagnostic) : `error` n'était jamais lu — le client Supabase ne
    // LÈVE PAS d'exception sur une erreur de requête (RLS refusée, colonne
    // manquante, etc.), il la renvoie dans `error`. En l'ignorant, un vrai
    // problème serveur (policy cassée, colonne pas encore migrée) donnait
    // exactement le même résultat visible qu'un agent normal sans rôle
    // admin — impossible à distinguer depuis l'écran, aucune trace console.
    if (error) {
      console.error("[ROLE] Lecture de user_roles échouée pour", user.id, ":", error.message, error);
      return;
    }
    console.info("[ROLE] user_roles pour", user.id, "=", data);
    const isAdmin = data?.role === "admin";
    // role=NULL (pas de ligne, ou ligne avec role NULL) = inscription pas
    // encore validée par un admin — RLS bloque déjà census_points côté
    // serveur (carte vide), mais l'UI doit l'EXPLIQUER plutôt que laisser
    // l'agent croire à un bug ou à une zone sans aucun point à recenser.
    const pendingApproval = !data?.role;
    store.set("ui.isAdmin", isAdmin);
    store.set("ui.pendingApproval", pendingApproval);
    store.set("ui.agentNumber", data?.agent_number ?? null);
    store.set("ui.fullName", data?.full_name || "");

    const adminRow = document.getElementById("adminTrackingRow");
    if (adminRow) adminRow.style.display = isAdmin ? "flex" : "none";
    // Export CSV réservé aux comptes admin (demande explicite) : un agent
    // terrain doit pouvoir UTILISER les données recensées, jamais les
    // exporter lui-même hors de l'app.
    const exportRow = document.getElementById("exportRow");
    if (exportRow) exportRow.style.display = isAdmin ? "flex" : "none";
    // Rapport PDF de tournée : même restriction que l'export CSV (demande
    // explicite, voir cadrage de la fonctionnalité).
    const tourReportRow = document.getElementById("tourReportRow");
    if (tourReportRow) tourReportRow.style.display = isAdmin ? "flex" : "none";
    // Appels de suivi : réservé à l'admin, même logique que le reste de ce
    // bloc — voir renderFollowUpList() pour le contenu.
    const followUpRow = document.getElementById("followUpRow");
    if (followUpRow) followUpRow.style.display = isAdmin ? "flex" : "none";

    renderAgentBadge();
    refreshEmptyStateContent();
  } catch (err) {
    // BUG corrigé (audit) : ce catch avalait TOUT le contenu du bloc try
    // sans trace — pas seulement le cas "table user_roles pas encore créée"
    // pour lequel il est commenté, mais aussi une éventuelle erreur JS
    // (TypeError sur une manipulation DOM ci-dessus, etc.), exactement le
    // type de bug silencieux que le correctif error/data plus haut visait
    // déjà à éliminer pour la requête Supabase elle-même. Le comportement
    // (repli sur le mode agent, pas d'exception qui remonte) est inchangé —
    // seule la trace console est ajoutée.
    console.error("[ROLE] refreshAdminRole() a échoué — repli sur le mode agent:", err);
  }
}

/**
 * Badge "Agent #N" affiché dans l'en-tête une fois le compte inscrit — voir
 * demande explicite : un agent doit pouvoir s'identifier avec ce numéro,
 * qu'il soit encore en attente de validation ou déjà approuvé.
 */
function renderAgentBadge() {
  const el = document.getElementById("agentNumberBadge");
  if (!el) return;
  const number = store.get("ui.agentNumber");
  if (number == null) {
    el.style.display = "none";
    return;
  }
  el.style.display = "inline-flex";
  el.textContent = store.get("ui.pendingApproval") ? `Agent #${number} · en attente` : `Agent #${number}`;
  el.classList.toggle("pending", Boolean(store.get("ui.pendingApproval")));
}

function bindEvents() {
  document.getElementById("logoutBtn").onclick = async () => {
    const ok = await confirmAction(
      "Déconnexion",
      "Voulez-vous vous déconnecter ? Les données non synchronisées seront conservées localement."
    );
    if (ok) {
      // stopAgentTracking() : sinon le setInterval(30s) du suivi agents
      // continue de tourner après déconnexion (session absente côté
      // Supabase) et martèle des requêtes vouées à échouer indéfiniment.
      stopAgentTracking();
      agentTrackingActive = false;
      const trackingBtn = document.getElementById("agentTrackingBtn");
      if (trackingBtn) trackingBtn.textContent = "📍 Suivi Agents Terrain";
      // BUG corrigé (audit) : emptyStateEl référençait encore le noeud DOM de
      // CETTE session après déconnexion (jamais remis à null hors du cas
      // "des points arrivent"). appShell.js remplace container.innerHTML au
      // prochain montage — le noeud référencé devient orphelin, mais
      // createEmptyStateIfNeeded() (voir plus bas) refuse de recréer l'état
      // vide tant que cette référence reste "truthy" : un agent qui voyait
      // la carte vide (compte en attente / 0 point) puis se déconnectait
      // perdait ce message pour toute la session suivante — carte
      // silencieusement blanche, sans indication du pourquoi.
      emptyStateEl = null;
      stopGeolocation();
      logout();
    }
  };

  document.getElementById("menuToggleBtn").onclick = () => {
    document.getElementById("controls").classList.toggle("open");
  };

  const themeBtn = document.getElementById("themeToggleBtn");
  themeBtn.innerHTML = getEffectiveTheme() === "dark" ? ICONS.sun : ICONS.moon;
  themeBtn.onclick = () => {
    const next = toggleTheme();
    themeBtn.innerHTML = next === "dark" ? ICONS.sun : ICONS.moon;
    setMapTheme(next);
  };

  const handleOpenCensus = () => {
    // RLS refuse déjà toute écriture pour un compte pas encore validé — le
    // signaler tout de suite plutôt que de laisser l'agent remplir toute
    // une fiche pour un enregistrement qui échouera silencieusement.
    if (store.get("ui.pendingApproval")) {
      toastWarning("Votre compte est en attente de validation par un administrateur — vous ne pouvez pas encore saisir de point.");
      return;
    }
    openCensusForm();
    closeControls();
  };

  document.getElementById("addCensusBtnHeader")?.addEventListener("click", handleOpenCensus);
  document.getElementById("addCensusBtnControl")?.addEventListener("click", handleOpenCensus);

  document.getElementById("closeControlsBtn")?.addEventListener("click", () => {
    closeControls();
  });

  // Sur document (survit aux remontages, contrairement aux éléments du
  // container) : gardé par appEventsInitialized, voir sa déclaration.
  if (!appEventsInitialized) {
    document.addEventListener("click", (e) => {
      const controls = document.getElementById("controls");
      const toggleBtn = document.getElementById("menuToggleBtn");
      if (controls && controls.classList.contains("open")) {
        if (!controls.contains(e.target) && !toggleBtn.contains(e.target)) {
          closeControls();
        }
      }
    });
  }

  ["filterCity", "filterQuartier", "filterBlock", "filterStatus", "filterVisited"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => applyFilters());
  });

  document.getElementById("locateBtn").onclick = () => {
    locateAndCenter();
    closeControls();
  };

  document.getElementById("nearestBtn").onclick = async () => {
    // Respecte les filtres actifs (ville/quartier notamment, voir
    // populateQuartierFilter) : un agent qui a sélectionné "Bingerville"
    // veut "le plus proche DANS Bingerville", pas sur tout le recensement —
    // sans ça, un filtre actif était silencieusement ignoré par ce bouton
    // alors qu'il s'appliquait déjà partout ailleurs (carte, stats, export).
    const filters = store.get("filters");
    const scoped = filterPoints(store.get("points"), filters);
    const zoneActive = (filters?.city && filters.city !== "all") || (filters?.quartier && filters.quartier !== "all");
    const res = await findNearestUnvisited(zoneActive ? scoped : undefined);
    if (res) {
      flyToPoint(res.point.lat, res.point.lon, 17);
      openPopup(res.point.id);
      // Signalé par un agent terrain : présenter un point à 10+ km comme
      // "le plus proche" sans nuance laisse croire à une proximité
      // immédiate — le recensement peut couvrir plusieurs zones séparées
      // par la lagune à Abidjan. Le point reste affiché (utile pour
      // planifier un déplacement en véhicule), mais avec un avertissement
      // explicite au lieu d'un silence trompeur (voir CONFIG.NEAREST_SEARCH_RADIUS_KM).
      if (!res.withinRadius) {
        const zone = res.point.quartier || res.point.city || "zone non renseignée";
        toastWarning(
          `Aucun point de recensement à proximité immédiate (rayon ${CONFIG.NEAREST_SEARCH_RADIUS_KM} km). ` +
          `Le plus proche se trouve à ${res.distance.toFixed(1)} km (${zone}) — trajet long, envisagez le mode Véhicule.`
        );
      }
    } else if (zoneActive) {
      toastInfo("Aucun point non-visité dans la zone filtrée. Essayez d'élargir le filtre ville/quartier.");
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
      // sourcesFailed : fonds clair et sombre préchargés ensemble (voir
      // offlineTiles.js) — un agent doit savoir si un seul des deux a
      // réellement été couvert, pas juste "ça a marché" en général.
      toastSuccess(
        `Zone préchargée (clair + sombre) : ${result.downloaded} tuiles téléchargées` +
        (result.skippedAlreadyCached ? `, ${result.skippedAlreadyCached} déjà en cache` : "") +
        (result.failed ? `, ${result.failed} échouées` : "") +
        (result.sourcesFailed?.length ? ` — fond ${result.sourcesFailed.join(" et ")} indisponible, non couvert` : "") + "."
      );
    } catch (err) {
      toastError(err.message || "Échec du préchargement de la zone.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  const renderGpsPowerBtn = () => {
    const btn = document.getElementById("gpsPowerBtn");
    if (!btn) return;
    const mode = store.get("geo.powerMode") || "auto";
    const profile = store.get("geo.powerProfile") || "normal";
    const label = mode === "high"
      ? "⚡ GPS : précision max"
      : mode === "saver"
        ? "🔋 GPS : économie"
        : `🔋 GPS : auto${profile === "saver" ? " · éco active" : ""}`;
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(mode !== "auto"));
    btn.classList.toggle("active", mode !== "auto");
  };
  document.getElementById("gpsPowerBtn")?.addEventListener("click", () => {
    cycleGpsPowerMode();
    renderGpsPowerBtn();
  });
  store.subscribe("geo.powerMode", renderGpsPowerBtn);
  store.subscribe("geo.powerProfile", renderGpsPowerBtn);
  renderGpsPowerBtn();

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
    // Non bloquant par conception (getRainAlert() ne lève jamais) : en
    // pratique quasi instantané, le widget météo a déjà rempli le cache.
    const rainAlert = await getRainAlert(pos.lat, pos.lng);
    if (rainAlert) toastWarning(`${rainAlert.icon} ${rainAlert.message}`);

    const points = store.get("points").filter(p => !p.visited);
    const { startTour } = await getTourModule();

    // BUG signalé (audit) : le premier arrêt de la tournée pouvait diverger
    // du résultat du bouton "Plus proche" — le glouton géométrique de
    // tourPlanner.js ignore la route réelle (lagune, sens unique...) pour
    // TOUS ses choix, par conception (voir ce module). On corrige au moins
    // le TOUT PREMIER arrêt via le même calcul routier que "Plus proche"
    // (findNearestUnvisited, déjà ORS/OSRM avec repli vol d'oiseau) — un
    // seul appel réseau, pas un par étape. Best-effort : un échec réseau ne
    // bloque pas la génération, le glouton géométrique reste un repli valide.
    let forcedFirstStopId;
    try {
      const nearest = await findNearestUnvisited(points);
      if (nearest?.point) forcedFirstStopId = nearest.point.id;
    } catch (err) {
      console.warn("Correction du premier arrêt de tournée par la route échouée, repli géométrique:", err?.message || err);
    }

    // Calcul déporté dans un Web Worker (core/computeClient.js) : sur un gros
    // recensement, le plus-proche-voisin pondéré + 2-opt bloquait le thread
    // UI le temps du calcul. Repli synchrone transparent si le Worker est
    // indisponible.
    const tour = await computeTourAsync(points, { lat: pos.lat, lng: pos.lng, heading: pos.heading }, undefined, forcedFirstStopId);
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
  document.getElementById("tourReportBtn").onclick = () => generateTourReport();

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
  document.getElementById("routeBanner")?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    const banner = document.getElementById("routeBanner");
    banner?.classList.remove("is-compact");
    if (routeBannerCollapseTimer) clearTimeout(routeBannerCollapseTimer);
  });
  document.getElementById("routeChoiceBtn")?.addEventListener("click", () => {
    const route = store.get("navigation.route");
    if (!route?.alternatives?.length || route.suggested === route.shortest) return;
    const next = route.selection === "shortest" ? "suggested" : "shortest";
    chooseRouteAlternative(next);
  });
  document.getElementById("navStopBtn").onclick = () => {
    store.set("navigation.active", false);
  };
  document.getElementById("navRecenterBtn").onclick = () => {
    recenterNavigation();
  };
  document.getElementById("navCollapseBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("navPanel");
    const button = document.getElementById("navCollapseBtn");
    const collapsed = panel?.classList.toggle("is-collapsed");
    button?.setAttribute("aria-expanded", String(!collapsed));
    button?.setAttribute("aria-label", collapsed ? "Développer le panneau de navigation" : "Réduire le panneau de navigation");
  });
  document.getElementById("navCollapseBtn")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  });
  let navTouchStartY = null;
  document.getElementById("navPanel")?.addEventListener("touchstart", (event) => {
    navTouchStartY = event.touches[0]?.clientY ?? null;
  }, { passive: true });
  document.getElementById("navPanel")?.addEventListener("touchend", (event) => {
    if (navTouchStartY === null) return;
    const delta = event.changedTouches[0]?.clientY - navTouchStartY;
    navTouchStartY = null;
    if (Math.abs(delta) < 30) return;
    const panel = document.getElementById("navPanel");
    const button = document.getElementById("navCollapseBtn");
    const collapsed = delta > 0;
    panel?.classList.toggle("is-collapsed", collapsed);
    button?.setAttribute("aria-expanded", String(!collapsed));
    button?.setAttribute("aria-label", collapsed ? "Développer le panneau de navigation" : "Réduire le panneau de navigation");
  }, { passive: true });
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
    btn.addEventListener("click", () => {
      setNavigationMode(btn.dataset.mode);
      document.getElementById("navModeRow")?.classList.add("is-collapsed");
    });
  });
  document.getElementById("arrivalYesBtn").onclick = () => markArrivedVisited();
  document.getElementById("arrivalNoBtn").onclick = () => {
    document.getElementById("arrivalBanner").style.display = "none";
  };

  // --- Model 1: Floating Map Controls ---
  document.getElementById("floatingLocateBtn")?.addEventListener("click", () => {
    locateAndCenter();
  });
  document.getElementById("zoomInBtn")?.addEventListener("click", () => {
    getMap()?.zoomIn();
  });
  document.getElementById("zoomOutBtn")?.addEventListener("click", () => {
    getMap()?.zoomOut();
  });

  document.getElementById("zoneSelectorPill")?.addEventListener("click", () => {
    document.getElementById("nearestBtn")?.click();
  });

  // --- Model 1: Merchant Bottom Sheet Close ---
  document.getElementById("closeSheetBtn")?.addEventListener("click", () => {
    document.getElementById("merchantBottomSheet")?.classList.remove("open");
    store.set("ui.selectedPointId", null);
  });
  document.getElementById("sheetDragHandle")?.addEventListener("click", () => {
    document.getElementById("merchantBottomSheet")?.classList.remove("open");
    store.set("ui.selectedPointId", null);
  });

  // --- Model 1: Bottom Navigation Bar ---
  const navTabs = {
    navTabMap: () => {
      closeControls();
      const tourPanel = document.getElementById("tourPanel");
      if (tourPanel) tourPanel.style.display = "none";
      const aiModal = document.getElementById("aiModal");
      if (aiModal) aiModal.style.display = "none";
      const agentsModal = document.getElementById("agentsModal");
      if (agentsModal) agentsModal.style.display = "none";
      const reportModal = document.getElementById("agentReportModal");
      if (reportModal) reportModal.style.display = "none";
    },
    navTabTasks: () => {
      document.getElementById("tourBtn")?.click();
    },
    navTabFabAdd: () => {
      handleOpenCensus();
    },
    navTabReports: () => {
      // BUG CORRIGÉ : ce bouton ouvrait le MÊME modal "Fiches recensées"
      // pour tout le monde, sans jamais désigner d'agent — un compte agent
      // normal (agentReportUserId jamais posé pour lui, cette variable
      // n'étant sinon renseignée que depuis le bouton "📋 Fiches" du
      // panneau admin, hors de portée d'un agent) tombait donc sur un
      // modal vide en permanence. Un agent voit maintenant SES PROPRES
      // fiches ; un admin garde en plus l'accès à celles de chaque agent
      // via Profil -> Comptes agents -> "📋 Fiches".
      const user = store.get("user");
      if (!user) return;
      setAgentReportTarget(user.id, store.get("ui.fullName") || (store.get("ui.agentNumber") ? `Agent #${store.get("ui.agentNumber")}` : "Mon compte"), "all");
      document.querySelectorAll("#agentReportPeriodGroup .segment-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.period === "all");
        b.setAttribute("aria-pressed", b.dataset.period === "all" ? "true" : "false");
      });
      const reportModal = document.getElementById("agentReportModal");
      if (reportModal) reportModal.style.display = "block";
      renderAgentReport();
    },
    navTabProfile: () => {
      if (store.get("ui.isAdmin")) {
        openAgentsModal();
      } else {
        document.getElementById("controls")?.classList.toggle("open");
      }
    }
  };

  Object.entries(navTabs).forEach(([id, action]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(tab => tab.classList.remove("active"));
      if (id !== "navTabFabAdd") el.classList.add("active");
      action();
    });
  });

  bindAiEvents();
  bindAgentsModalEvents();
}

function bindStoreListeners() {
  store.subscribe("points", (points) => {
    updateStats();
    renderQuartierCoverage();
    populateBlockFilter(points);
    populateQuartierFilter(points);
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

  // Les villes arrivent en asynchrone (loadCities non bloquant) — si le
  // panneau admin est déjà ouvert au moment de la réception, il se peuple ;
  // le filtre "Ville" aussi (ajout/suppression par l'admin).
  store.subscribe("cities", (cities) => {
    renderCitiesList();
    populateCityFilter(cities);
  });

  const renderSyncStatus = () => {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    const status = store.get("sync.status");
    const deadCount = store.get("sync.deadCount") || 0;
    const deadPhotoCount = store.get("sync.deadPhotoCount") || 0;
    const deadSheetsCount = store.get("sync.deadSheetsCount") || 0;
    const pendingCount = store.get("sync.pendingCount") || 0;
    const conflicts = store.get("sync.conflicts") || [];
    const dataSource = store.get("sync.dataSource");
    const lastError = store.get("sync.lastError") || store.get("sync.errorDetail");
    const partialLoad = store.get("sync.partialLoad");

    if (deadCount > 0) {
      el.textContent = `⚠️ ${deadCount} fiche${deadCount > 1 ? "s" : ""} bloquée${deadCount > 1 ? "s" : ""} — Voir`;
      el.title = lastError || "Ces fiches n'ont pas pu être envoyées après plusieurs tentatives. Cliquez pour voir les détails.";
      el.className = "sync-status sync-status-error";
      el.style.cursor = "pointer";
      el.onclick = async () => {
        toastWarning(`${deadCount} fiche(s) bloquée(s). ${lastError || "Nouvelle tentative en cours..."}`);
        await retryFailedSyncs();
      };
      return;
    }

    // Distinct de deadCount ci-dessus : une photo bloquée ne bloque JAMAIS
    // la fiche elle-même (déjà synchronisée sans elle, voir syncEngine.js:
    // triggerPhotoUpload()) — avertissement de priorité moindre, affiché
    // seulement si rien de plus urgent (fiche bloquée, conflit) n'est déjà là.
    if (deadPhotoCount > 0) {
      el.textContent = `📷 ${deadPhotoCount} photo${deadPhotoCount > 1 ? "s" : ""} non envoyée${deadPhotoCount > 1 ? "s" : ""} — Voir`;
      el.title = "Ces photos n'ont pas pu être envoyées après plusieurs tentatives (fiches déjà synchronisées sans elles). Cliquez pour réessayer.";
      el.className = "sync-status sync-status-error";
      el.style.cursor = "pointer";
      el.onclick = async () => {
        toastWarning(`${deadPhotoCount} photo(s) en attente de renvoi...`);
        await retryDeadPhotos();
        await triggerPhotoUpload();
      };
      return;
    }

    // Priorité encore moindre que deadPhotoCount : un échec Sheets ne touche
    // ni le point ni sa photo, seulement le double export optionnel.
    if (deadSheetsCount > 0) {
      el.textContent = `📊 ${deadSheetsCount} fiche${deadSheetsCount > 1 ? "s" : ""} non envoyée${deadSheetsCount > 1 ? "s" : ""} à Google Sheets — Voir`;
      el.title = "Échec du double envoi vers Google Sheets après plusieurs tentatives (fiches déjà synchronisées sur Supabase). Cliquez pour réessayer.";
      el.className = "sync-status sync-status-error";
      el.style.cursor = "pointer";
      el.onclick = async () => {
        toastWarning(`${deadSheetsCount} fiche(s) en attente de renvoi vers Google Sheets...`);
        await retryDeadSheetsSyncs();
        await triggerSheetsSync();
      };
      return;
    }

    if (conflicts.length > 0) {
      el.textContent = `🔀 ${conflicts.length} conflit${conflicts.length > 1 ? "s" : ""} de sync — Voir`;
      el.className = "sync-status sync-status-error";
      el.title = "Ces fiches ont visiblement été modifiées ailleurs pendant que vous étiez hors-ligne. Cliquez pour les revoir une par une.";
      el.style.cursor = "pointer";
      el.onclick = () => reviewNextConflict();
      return;
    }

    if (partialLoad) {
      el.textContent = "⚠️ Chargement partiel — Voir";
      el.className = "sync-status sync-status-error";
      el.title = partialLoad.message;
      el.style.cursor = "pointer";
      el.onclick = () => toastWarning(partialLoad.message);
      return;
    }

    el.onclick = null;
    el.style.cursor = "default";
    if (status === "syncing" && pendingCount > 0) {
      el.textContent = `🔄 Sync... ${pendingCount} restante${pendingCount > 1 ? "s" : ""}`;
      el.className = "sync-status sync-status-syncing";
      el.title = "Synchronisation avec Supabase en cours.";
    } else if (status === "error") {
      el.textContent = "⚠️ Échec sync — Voir";
      el.className = "sync-status sync-status-error";
      el.title = lastError || "La synchronisation a échoué. Cliquez pour afficher les détails.";
      el.style.cursor = "pointer";
      el.onclick = () => toastWarning(lastError || "Une erreur de synchronisation est survenue.");
    } else if (dataSource === "cache" || status === "offline") {
      el.textContent = "◌ Cache local";
      el.className = "sync-status sync-status-cache";
      el.title = "Données affichées depuis le stockage local. Elles restent utilisables hors connexion.";
    } else {
      el.textContent = "✓ À jour";
      el.className = "sync-status sync-status-ready";
      el.title = "Données synchronisées avec Supabase.";
    }
  };

  store.subscribe("sync.status", renderSyncStatus);
  store.subscribe("sync.deadCount", renderSyncStatus);
  store.subscribe("sync.deadPhotoCount", renderSyncStatus);
  store.subscribe("sync.deadSheetsCount", renderSyncStatus);
  store.subscribe("sync.pendingCount", renderSyncStatus);
  store.subscribe("sync.conflicts", renderSyncStatus);
  store.subscribe("sync.dataSource", renderSyncStatus);
  store.subscribe("sync.lastError", renderSyncStatus);
  store.subscribe("sync.partialLoad", renderSyncStatus);

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
    // Mode immersif (demande explicite) : pendant le guidage, tout le chrome
    // non essentiel disparaît pour ne laisser que la carte + le panneau de
    // navigation — voir style.css (.app-header/.legend/.bottom-nav-bar sous
    // body.nav-immersive). #navStopBtn (dans #navPanel, jamais masqué) et le
    // ✕ de #routeBanner restent l'unique façon de sortir de la navigation.
    document.body.classList.toggle("nav-immersive", active);
    const banner = document.getElementById("routeBanner");
    if (banner) banner.style.display = active ? "flex" : "none";
    const hud = document.getElementById("navHud");
    if (hud) {
      hud.hidden = !active;
      if (active) {
        document.getElementById("hudModeIcon").textContent =
          ({ foot: "🚶", bike: "🚲", car: "🚗" })[store.get("navigation.mode")] || "🚶";
        document.getElementById("hudManeuver").textContent =
          store.get("navigation.nextInstruction") || "Continuez tout droit";
        document.getElementById("hudMeta").textContent = store.get("navigation.instruction") || "";
      }
    }
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
    const routeBanner = document.getElementById("routeBanner");
    if (routeBanner) {
      routeBanner.classList.remove("is-compact");
      if (routeBannerCollapseTimer) clearTimeout(routeBannerCollapseTimer);
      if (active) {
        routeBannerCollapseTimer = setTimeout(() => {
          routeBanner.classList.add("is-compact");
        }, 7000);
      }
    }
    if (!active) document.getElementById("navModeRow")?.classList.remove("is-collapsed");
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
    const choiceBtn = document.getElementById("routeChoiceBtn");
    if (choiceBtn) choiceBtn.style.display = "none";
  });

  store.subscribe("navigation.instruction", (text) => {
    const el = document.getElementById("navInstruction");
    if (el) el.textContent = text || "—";
    const panel = document.getElementById("navPanel");
    if (panel) {
      const loading = /calcul de l'itinéraire/i.test(text || "");
      panel.classList.toggle("is-loading", loading);
      panel.setAttribute("aria-busy", String(loading));
    }
    const infoEl = document.getElementById("routeInfo");
    if (infoEl) infoEl.textContent = text || "";
    const hudMeta = document.getElementById("hudMeta");
    if (hudMeta) hudMeta.textContent = text || "";
    const route = store.get("navigation.route");
    const choiceBtn = document.getElementById("routeChoiceBtn");
    const choiceLabel = document.getElementById("routeChoiceLabel");
    const hasChoice = route?.alternatives?.length > 1 && route.suggested !== route.shortest;
    if (choiceBtn) {
      choiceBtn.style.display = hasChoice ? "inline-flex" : "none";
      choiceBtn.textContent = route?.selection === "shortest" ? "Voir le suggéré" : "Voir le plus court";
    }
    if (choiceLabel) choiceLabel.textContent = hasChoice
      ? (route.selection === "shortest" ? " · Le plus court" : " · Suggéré, estimation horaire")
      : "";
  });

  // #navSub était déclaré dans le HTML mais jamais rempli : le guidage
  // pas-à-pas (prochaine manœuvre OSRM) l'alimente maintenant.
  store.subscribe("navigation.nextInstruction", (text) => {
    const el = document.getElementById("navSub");
    if (el) el.textContent = text || "";
    const hudManeuver = document.getElementById("hudManeuver");
    if (hudManeuver) hudManeuver.textContent = text || (store.get("navigation.active") ? "Continuez tout droit" : "—");
  });

  store.subscribe("navigation.mode", (mode) => {
    const icon = document.getElementById("hudModeIcon");
    if (icon) icon.textContent = ({ foot: "🚶", bike: "🚲", car: "🚗" })[mode] || "🚶";
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

  store.subscribe("ui.selectedPointId", (pointId) => {
    if (!pointId) {
      document.getElementById("merchantBottomSheet")?.classList.remove("open");
      return;
    }
    const points = store.get("points") || [];
    const point = points.find(p => String(p.id) === String(pointId));
    if (point) {
      renderMerchantBottomSheet(point);
    }
  });
}

function renderMerchantBottomSheet(point) {
  const sheet = document.getElementById("merchantBottomSheet");
  if (!sheet) return;
  if (!point) {
    sheet.classList.remove("open");
    return;
  }
  const userPos = store.get("geo.position");
  const model = buildPopupModel(point, userPos);

  const nameEl = document.getElementById("sheetMerchantName");
  if (nameEl) nameEl.textContent = model.name || "Établissement";

  const statusBadge = document.getElementById("sheetStatusBadge");
  if (statusBadge) {
    statusBadge.textContent = model.status || "Non défini";
    const color = CONFIG.STATUS_COLORS[point.status] || "#95a5a6";
    const textColor = CONFIG.STATUS_TEXT_COLORS[point.status] || "#566573";
    statusBadge.style.background = `${color}22`;
    statusBadge.style.color = textColor;
    statusBadge.style.borderColor = color;
  }

  const distanceEl = document.getElementById("sheetDistance");
  if (distanceEl) {
    distanceEl.textContent = model.distanceLabel ? `• ${model.distanceLabel}` : "";
  }

  const ownerEl = document.getElementById("sheetOwner");
  if (ownerEl) {
    ownerEl.textContent = point.proprio || point.agent || "Non renseigné";
  }

  const addressEl = document.getElementById("sheetAddress");
  if (addressEl) {
    addressEl.textContent = model.address || model.quartier || "Adresse non spécifiée";
  }

  const activityTag = document.getElementById("sheetActivityTag");
  if (activityTag) {
    activityTag.textContent = model.activityType || model.produits || "Commerce général";
  }

  const telRow = document.getElementById("sheetTelRow");
  const telLink = document.getElementById("sheetTelLink");
  if (telRow && telLink) {
    if (model.tel) {
      telRow.style.display = "flex";
      telLink.href = `tel:${model.tel}`;
      telLink.textContent = model.tel;
    } else {
      telRow.style.display = "none";
    }
  }

  const gpsAcc = store.get("geo.accuracy");
  const gpsText = document.getElementById("sheetGpsText");
  if (gpsText) {
    gpsText.textContent = gpsAcc ? `GPS: Stable • ${Math.round(gpsAcc)}m ✓` : "GPS: Stable ✓";
  }

  const syncStatus = store.get("sync.status");
  const syncText = document.getElementById("sheetSyncText");
  if (syncText) {
    syncText.textContent = syncStatus === "offline" ? "Mode Hors ligne ✓" : "Mode Hors ligne • Synch. ✓";
  }

  // Action buttons
  const primaryBtn = document.getElementById("sheetActionPrimary");
  if (primaryBtn) {
    primaryBtn.onclick = () => {
      openCensusForm();
    };
  }

  const routeBtn = document.getElementById("sheetActionRoute");
  if (routeBtn) {
    routeBtn.onclick = () => {
      store.set("navigation.destination", { ...point });
      store.set("navigation.active", true);
      sheet.classList.remove("open");
    };
  }

  const visitBtn = document.getElementById("sheetActionVisit");
  if (visitBtn) {
    visitBtn.textContent = point.visited ? "✓ Visité" : "✅ Marquer visité";
    visitBtn.onclick = async () => {
      const newVisited = !point.visited;
      if (newVisited && !canMarkVisited(point.lat, point.lon)) return;
      await updatePointVisit(point.id, newVisited, point.status, store.get("geo.position"));
      const points = (store.get("points") || []).map(p =>
        String(p.id) === String(point.id) ? { ...p, visited: newVisited } : p
      );
      store.set("points", points);
      toastSuccess(newVisited ? "Point marqué comme visité." : "Visite annulée.");
      renderMerchantBottomSheet({ ...point, visited: newVisited });
    };
  }

  const editBtn = document.getElementById("sheetActionEdit");
  if (editBtn) {
    editBtn.onclick = () => {
      openCensusForm(point);
    };
  }

  sheet.classList.add("open");
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
