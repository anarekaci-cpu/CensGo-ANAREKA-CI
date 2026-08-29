import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { savePoints, mergePoints, getAllPoints, getMeta, setMeta } from "../../db/database.js";
import { normalizePoint } from "../../core/normalize.js";
import { log, isVerbose } from "../../core/debug.js";

// Traduit une erreur Supabase/PostgREST en message actionnable pour un
// agent terrain. Sans ça, une policy RLS bloquante ou une table vide
// produisait le même écran "Aucun point" — impossible à diagnostiquer.
function describeSyncError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err);
  if (/timeout|aborted|AbortError/i.test(msg)) {
    return "Le serveur Supabase met trop de temps à répondre. Les données locales restent disponibles ; la synchronisation reprendra automatiquement.";
  }
  if (code === "42501" || /row-level security/i.test(msg)) {
    return "Accès refusé par la base (RLS). Contactez l'administrateur : les règles d'accès bloquent la lecture des points.";
  }
  if (code === "42P01") {
    return `Table "${CONFIG.TABLE_NAME}" introuvable sur le serveur. Le schéma Supabase n'a pas été initialisé.`;
  }
  if (code === "42703") {
    return `Colonne manquante dans "${CONFIG.TABLE_NAME}" : ${msg}. Le schéma du projet ne correspond pas à l'application.`;
  }
  if (/JWT|api ?key|Invalid API key/i.test(msg)) {
    return "Clé API Supabase invalide ou expirée. Vérifiez VITE_SUPABASE_ANON_KEY.";
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return "Serveur Supabase injoignable. Vérifiez la connexion internet.";
  }
  return msg;
}

// --- Instrumentation perf (performance.mark/measure) ---
// Permet de mesurer chaque étape du pipeline de chargement dans l'onglet
// Performance des DevTools, et affiche un résumé compact en console.
const perfSteps = [];
let perfT0 = 0;

function perfStart() {
  perfSteps.length = 0;
  perfT0 = performance.now();
}

function perfMark(label) {
  const t = performance.now();
  perfSteps.push({ label, ms: Math.round(t - perfT0) });
  try {
    performance.mark(`anareka:${label}`);
  } catch { /* environnements sans performance.mark */ }
}

function perfReport(totalLabel = "TOTAL") {
  if (perfSteps.length === 0) return;
  const parts = perfSteps.map(s => `${s.label} ${s.ms}ms`);
  console.info(`⏱️ [PERF] ${parts.join(" · ")} · ${totalLabel} ${Math.round(performance.now() - perfT0)}ms`);
}

// Timeout réseau : supabase-js n'en impose AUCUN par défaut. Sur un réseau
// mobile dégradé, une requête qui restait suspendue bloquait l'affichage des
// données pendant des MINUTES (le fameux chargement de 5-10 min) alors que
// les données étaient déjà disponibles dans IndexedDB.
const REMOTE_TIMEOUT_MS = 12000;

// Pagination (#25) : le dataset est téléchargé par lots pour ne pas dépendre
// d'une seule réponse géante (limite PostgREST, mémoire, réseau instable).
// L'affichage n'attend PAS ces lots : le cache IndexedDB est déjà à l'écran.
const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // garde-fou : 100 x 1000 = 100k points max

/**
 * Télécharge TOUTES les lignes par pages de PAGE_SIZE.
 * Chaque page a son propre timeout ; en cas d'échec après au moins une page
 * reçue, on retourne ce qui a été obtenu plutôt que de tout jeter.
 */
export async function fetchAllPages(supabase, { since = null } = {}) {
  const allRows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    let query = supabase
      .from(CONFIG.TABLE_NAME)
      // Colonnes explicites plutôt que select(*) : pas de colonne inutile
      // téléchargée (le volume transféré compte sur lien 3G terrain).
      // ATTENTION : "created_at", "city" et "photo_path" doivent être
      // RÉELLEMENT présentes sur census_points avant de les demander ici
      // (schema.sql pour created_at, supabase/add_cities.sql pour city,
      // supabase/add_census_photos.sql pour photo_path) — sinon PostgREST
      // renvoie 42703 sur CHAQUE requête, rejetant la page 0 avant tout
      // affichage et bloquant toute synchro (déjà vécu sur ce projet, voir
      // le commentaire équivalent dans schema.sql).
      .select("point_id,block,order,name,tel,etablissement,activity_type,city,quartier,address,produits,sexe,status,visited,lat,lon,updated_at,created_at,created_by,photo_path")
      .order("block", { ascending: true })
      .order("order", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (since) query = query.gte("updated_at", since);
    // Le timeout doit être nettoyé même si supabase-js rejette la promesse
    // (fermeture de page, annulation réseau ou erreur transport). Les appels
    // du moteur de sync ont déjà cette garantie via withTimeout(); la
    // pagination doit l'avoir également pour ne pas accumuler des timers.
    let response;
    try {
      response = await query.abortSignal(controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
    const { data, error } = response;

    if (error) {
      if (allRows.length > 0) {
        // Réseau coupé en cours de pagination : on garde les pages reçues.
        const warning = `Synchronisation partielle : ${page} page(s), ${allRows.length} ligne(s) reçue(s) avant l'interruption. Les données locales sont conservées.`;
        store.set("sync.partialLoad", { pages: page, rows: allRows.length, message: warning });
        store.set("sync.warning", warning);
        console.warn(`[DATA] ${warning}`, error.message);
        return allRows;
      }
      throw error;
    }

    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break; // dernière page atteinte
    console.info(`📥 [DATA] Page ${page + 1} reçue (${allRows.length} lignes)...`);
  }
  return allRows;
}

// Promesse partagée : plusieurs modules peuvent demander un chargement au
// même moment (initApp, resetBtn, retour online...). Une seule requête
// réseau part réellement ; les autres attendent le même résultat.
let loadPromise = null;

/**
 * Charge les données de recensement — architecture CACHE-FIRST :
 *
 *   1. IndexedDB immédiatement  -> interface + carte utilisables en <1s
 *   2. Supabase en arrière-plan -> fusion, mise à jour store + IndexedDB
 *
 * L'utilisateur ne JAMAIS attendre le réseau pour commencer à travailler.
 * @param {boolean} forceOffline - saute l'appel Supabase (mode avion assumé)
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] - ignore la promesse partagée en cours
 * @returns {Promise<object[]>} points normalisés affichés
 */
export function loadCensusData(forceOffline = false, { forceRefresh = false, forceFullSync = false } = {}) {
  if (loadPromise && !forceRefresh) return loadPromise;
  loadPromise = _loadCensusData(forceOffline, { forceRefresh, forceFullSync }).finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

async function _loadCensusData(forceOffline, { forceFullSync = false, forceRefresh = false } = {}) {
  perfStart();
  const tStartAll = performance.now();
  perfMark("INIT");

  // ===== ÉTAPE 1 : CACHE LOCAL (instantané, ne bloque jamais l'UI) =====
  let localPoints = [];
  let lastSync = null;
  const t0IdbRead = performance.now();
  try {
    localPoints = await getAllPoints();
    const durationIdbRead = Math.round(performance.now() - t0IdbRead);
    log.trace("INDEXEDDB", `read = true\npoints = ${localPoints.length}\ndurationMs = ${durationIdbRead}`);
    perfMark("INDEXEDDB");
  } catch (err) {
    console.error("[DATA] Lecture IndexedDB impossible:", err);
    log.trace("INDEXEDDB", `read = false\npoints = 0\ndurationMs = ${Math.round(performance.now() - t0IdbRead)}`);
  }

  if (localPoints.length > 0) {
    store.set("points", localPoints);
    log.trace("STORE", `pointsCount = ${localPoints.length}`);
    if (isVerbose()) {
      const sample = store.get("points")?.find(p => p.id === "bgv_b01_01");
      if (sample) log.trace("STORE", "sample bgv_b01_01 =", sample);
    }
    store.set("ui.loading", false);
    store.set("sync.dataSource", "cache");
    store.set("sync.status", navigator.onLine ? "syncing" : "offline");
    console.info(`📦 ${localPoints.length} points affichés depuis IndexedDB (cache-first)`);
  }

  if (forceOffline || !navigator.onLine) {
    store.set("ui.loading", false);
    store.set("sync.status", "offline");
    if (localPoints.length === 0) {
      store.set("ui.error", "Aucune donnée locale et application hors ligne. Reconnectez-vous puis rechargez.");
    }
    perfMark("FIN-OFFLINE");
    perfReport();
    return localPoints;
  }

  // ===== ÉTAPE 2 : SUPABASE EN ARRIÈRE-PLAN =====
  store.set("sync.status", "syncing");

  let supabaseDuration = 0;
  let normalizeDuration = 0;
  let idbWriteDuration = 0;

  try {
    const supabase = getSupabaseClient();

    perfMark("SUPABASE-START");
    const t0Supa = performance.now();
    let data = null;
    let supaError = null;
    try {
      lastSync = !forceFullSync && !forceRefresh ? await getMeta("lastSync") : null;
      store.set("sync.warning", null);
      store.set("sync.partialLoad", null);
      data = await fetchAllPages(supabase, { since: lastSync });
    } catch (e) {
      supaError = e;
    }
    supabaseDuration = Math.round(performance.now() - t0Supa);
    log.trace("SUPABASE", `table = ${CONFIG.TABLE_NAME}\nrows = ${data ? data.length : 0}\nerror = ${supaError ? (supaError.message || supaError) : null}\ndurationMs = ${supabaseDuration}`);
    perfMark("SUPABASE");

    if (supaError) throw supaError;

    if (!data || data.length === 0) {
      console.warn(
        `[DATA] Requête Supabase OK mais 0 ligne dans "${CONFIG.TABLE_NAME}". ` +
        "Causes possibles : (1) policies RLS SELECT absentes/restrictives, " +
        "(2) table réellement vide, (3) mauvais projet Supabase."
      );
      store.set("sync.warning",
        "Le serveur a répondu mais n'a renvoyé AUCUN point. " +
        "Si des points existent dans le dashboard Supabase, " +
        "les règles d'accès (RLS) bloquent la lecture."
      );
      store.set("sync.status", localPoints.length > 0 ? "idle" : "error");
      store.set("sync.dataSource", localPoints.length > 0 ? "cache" : "none");
      store.set("ui.loading", false);
      perfMark("FIN-VIDE");
      perfReport();
      return localPoints;
    }

    // Normalisation
    const t0Norm = performance.now();
    const formatted = data.map(normalizePoint);
    normalizeDuration = Math.round(performance.now() - t0Norm);
    // formatted[0] contient des données personnelles (nom, tél, adresse) —
    // ne jamais l'écrire en console hors mode DEBUG explicite.
    log.trace("NORMALIZE", `input = ${data.length}\noutput = ${formatted.length}\nfirst =`, isVerbose() ? formatted[0] : undefined);
    perfMark("NORMALISATION");

    // Persistance IndexedDB
    const t0Write = performance.now();
    if (lastSync && !forceFullSync && !forceRefresh) {
      if (formatted.length > 0) await mergePoints(formatted);
    } else {
      await savePoints(formatted);
    }
    const merged = await getAllPoints();
    idbWriteDuration = Math.round(performance.now() - t0Write);
    log.trace("INDEXEDDB", `write = true\npoints = ${merged.length}\ndurationMs = ${idbWriteDuration}`);
    perfMark("PERSISTENCE");

    const nowIso = new Date().toISOString();
    await setMeta("lastSync", nowIso);
    store.set("points", merged);
    log.trace("STORE", `pointsCount = ${merged.length}`);
    if (isVerbose()) {
      const foundSample = store.get("points")?.find(p => p.id === "bgv_b01_01");
      log.trace("STORE", "find bgv_b01_01 =", foundSample || undefined);
    }

    store.set("sync.status", "idle");
    store.set("sync.dataSource", "server");
    store.set("sync.lastSync", nowIso);
    store.set("sync.warning", null);
    store.set("sync.errorDetail", null);
    store.set("ui.loading", false);
    store.set("ui.error", null);

    const totalDuration = Math.round(performance.now() - tStartAll);
    console.log(`[PERF]\nsupabase = ${supabaseDuration}ms\nnormalize = ${normalizeDuration}ms\nindexedDB = ${idbWriteDuration}ms\nstore = ${merged.length} pts\nmap = ok\nmarkers = ok\nstats = ok\ntotal = ${totalDuration}ms`);

    console.log(`📥 ${merged.length} points chargés depuis Supabase`);
    perfMark("STORE");
    perfReport();
    return merged;
  } catch (err) {
    console.error("[DATA] Échec du chargement Supabase:", err);
    store.set("sync.errorDetail", describeSyncError(err));
    store.set("sync.lastError", describeSyncError(err));
    store.set("sync.status", localPoints.length > 0 ? "offline" : "error");
    store.set("ui.loading", false);
    if (localPoints.length === 0) {
      store.set("ui.error",
        `Aucune donnée disponible. ${describeSyncError(err)}`);
    }
    perfMark("FIN-ERREUR");
    perfReport();
    return localPoints;
  }
}
