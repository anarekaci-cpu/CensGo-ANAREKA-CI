// Suivi des erreurs JavaScript en production — sans service externe.
//
// Les erreurs non gérées (window "error", "unhandledrejection") et celles
// signalées explicitement via reportError() sont :
//   1. nettoyées (e-mails et numéros de téléphone masqués, URL sans query),
//   2. dédoublonnées par empreinte (même erreur = +1 au compteur),
//   3. mises en file locale (localStorage) — hors connexion ou avant login,
//   4. envoyées par lots dans la table Supabase public.client_errors
//      (voir supabase/add_client_errors.sql), insertion réservée aux comptes
//      connectés, lecture réservée aux admins.
//
// Désactivé tant que VITE_ENABLE_ERROR_REPORTING !== "true" (la table doit
// exister d'abord). Ne lève JAMAIS d'exception : un bug du rapporteur ne
// doit pas créer de nouveaux bugs.

const QUEUE_KEY = "censgo.errorQueue.v1";
const MAX_QUEUE = 50;
const MAX_PER_SESSION = 30;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

let enabled = false;
let sentThisSession = 0;
let flushing = false;
let getClient = null;
let appVersion = "";
let listenersInstalled = false;

/** Masque les données personnelles courantes avant tout stockage. */
export function scrub(text) {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+?225[\s.-]?)?(?:\d[\s.-]?){10}/g, "[tel]")
    .replace(/(eyJ[\w-]{10,})\.[\w-]+\.[\w-]+/g, "[jwt]");
}

/** Empreinte stable : message + première ligne de pile, sans numéros de colonne. */
export function fingerprint(message, stack) {
  const firstFrame = String(stack || "").split("\n").find(l => /at |@/.test(l)) || "";
  const raw = `${message}|${firstFrame.replace(/:\d+:\d+\)?$/, "")}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* quota */ }
}

/** Construit l'entrée (exportée pour les tests). */
export function buildEntry(error, context = {}) {
  const message = scrub(error?.message || String(error || "Erreur inconnue")).slice(0, MAX_MESSAGE);
  const stack = scrub(error?.stack || "").slice(0, MAX_STACK);
  let page = "";
  try { page = `${location.origin}${location.pathname}`; } catch { /* hors navigateur */ }
  return {
    fingerprint: fingerprint(message, stack),
    message,
    stack,
    source: String(context.source || "manual").slice(0, 60),
    page,
    app_version: appVersion,
    user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 300),
    online: typeof navigator !== "undefined" ? navigator.onLine : null,
    occurrences: 1,
    first_seen: new Date().toISOString()
  };
}

/**
 * Signale une erreur (attrapée dans un try/catch par exemple).
 * @param {unknown} error
 * @param {{ source?: string }} [context]
 */
export function reportError(error, context) {
  if (!enabled) return;
  try {
    const entry = buildEntry(error, context);
    const queue = readQueue();
    const existing = queue.find(e => e.fingerprint === entry.fingerprint);
    if (existing) existing.occurrences += 1;
    else queue.push(entry);
    writeQueue(queue);
    scheduleFlush();
  } catch { /* jamais bloquant */ }
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushErrors(); }, 5000);
}

/** Envoie la file si connecté et en ligne. */
export async function flushErrors() {
  if (!enabled || flushing || !getClient) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length || sentThisSession >= MAX_PER_SESSION) return;
  flushing = true;
  try {
    const supabase = getClient();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return; // pas connecté : on garde la file
    const batch = queue.slice(0, MAX_PER_SESSION - sentThisSession);
    const { error } = await supabase.from("client_errors").insert(batch);
    if (!error) {
      sentThisSession += batch.length;
      writeQueue(readQueue().filter(e => !batch.some(b => b.fingerprint === e.fingerprint)));
    }
  } catch { /* réessai au prochain déclencheur */ } finally {
    flushing = false;
  }
}

/**
 * @param {{ enabled: boolean, getSupabaseClient: () => any, version?: string }} opts
 */
export function initErrorReporter(opts) {
  enabled = !!opts?.enabled;
  if (!enabled || typeof window === "undefined") return;
  getClient = opts.getSupabaseClient;
  appVersion = String(opts.version || "");
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener("error", (e) => {
    // Échec de chargement d'une ressource (image, tuile) : pas une erreur JS.
    if (!e.error && e.target && e.target !== window) return;
    reportError(e.error || new Error(e.message), { source: "window.error" });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    // Coupures réseau attendues sur le terrain : bruit, pas un bug.
    if (/Failed to fetch|NetworkError|Load failed|AbortError/i.test(reason.message)) return;
    reportError(reason, { source: "unhandledrejection" });
  });
  window.addEventListener("online", () => flushErrors());
  setTimeout(flushErrors, 15000);
}
