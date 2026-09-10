/**
 * Client du Web Worker de calcul (core/computeWorker.js).
 *
 * Expose des variantes ASYNCHRONES des fonctions pures lourdes du noyau. Le
 * calcul part dans le Worker ; le thread principal reste libre pour animer la
 * carte à 60 FPS. Repli SYNCHRONE transparent (même résultat) si :
 *  - l'environnement n'a pas de Worker (jsdom des tests, très vieux WebView) ;
 *  - la construction du Worker échoue ;
 *  - le Worker ne répond pas dans WORKER_TIMEOUT_MS (bloqué, script cassé).
 *
 * Les entrées/sorties sont des objets simples (clonage structuré) — aucune
 * fonction, aucune instance de classe ne transite.
 */

import { generateOptimizedTour } from "./tourPlanner.js";
import { computeStats } from "./analytics.js";
import { filterPoints } from "./filters.js";

const WORKER_TIMEOUT_MS = 4000;

let worker = null; // null = pas encore tenté, false = indisponible (repli définitif)
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker || null;
  try {
    if (typeof Worker === "undefined") { worker = false; return null; }
    worker = new Worker(new URL("./computeWorker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e) => {
      const { id, result, error } = e.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });
    worker.addEventListener("error", () => {
      // Le Worker est mort : rejeter les requêtes en vol, elles retomberont
      // sur le repli synchrone via leur propre catch.
      for (const [, entry] of pending) entry.reject(new Error("compute worker error"));
      pending.clear();
      worker = false;
    });
  } catch {
    worker = false;
    return null;
  }
  return worker || null;
}

function runFallback(fallbackFn, args, resolve, reject) {
  try { resolve(fallbackFn(...args)); }
  catch (err) { reject(err); }
}

function call(op, args, fallbackFn) {
  const w = getWorker();
  if (!w) return new Promise((resolve, reject) => runFallback(fallbackFn, args, resolve, reject));

  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // Worker trop lent ou bloqué : on ne fait pas attendre l'agent.
      runFallback(fallbackFn, args, resolve, reject);
    }, WORKER_TIMEOUT_MS);

    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: () => { clearTimeout(timer); runFallback(fallbackFn, args, resolve, reject); }
    });

    try {
      w.postMessage({ id, op, args });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      runFallback(fallbackFn, args, resolve, reject);
      void err;
    }
  });
}

/** @returns {Promise<object[]>} tournée optimisée — voir tourPlanner.generateOptimizedTour */
export function computeTourAsync(...args) {
  return call("tour", args, generateOptimizedTour);
}

/** @returns {Promise<object>} statistiques — voir analytics.computeStats */
export function computeStatsAsync(...args) {
  return call("stats", args, computeStats);
}

/** @returns {Promise<object[]>} points filtrés — voir filters.filterPoints */
export function filterPointsAsync(...args) {
  return call("filter", args, filterPoints);
}

/** Libère le Worker (tests, changement de session). */
export function terminateComputeWorker() {
  if (worker && typeof worker.terminate === "function") worker.terminate();
  worker = null;
  pending.clear();
}
