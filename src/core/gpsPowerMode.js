/**
 * Mode économie de batterie pour le GPS.
 *
 * watchPosition({ enableHighAccuracy: true }) garde le récepteur GNSS actif
 * en continu : c'est le premier poste de consommation batterie d'une PWA
 * terrain utilisée 6–8 h d'affilée. Deux situations ne le justifient pas :
 *  - batterie faible (<= seuil) ET téléphone non branché ;
 *  - agent immobile (pause, saisie d'une fiche, déjeuner) — rafraîchir la
 *    position plusieurs fois par seconde n'apporte alors rien.
 *
 * Ce module = logique PURE : détection d'immobilité + choix du "profil"
 * d'acquisition. L'acquisition réelle et le ré-armement du watch restent
 * dans modules/geolocation/geolocation.js. La préférence agent (auto / éco
 * forcée / précision max forcée) est persistée en localStorage, sur le même
 * modèle que core/speech.js et core/theme.js.
 */

import { haversineKm } from "./geo.js";

// En dessous de ce niveau de batterie (0–1) et hors charge, le profil "auto"
// bascule en économie. 0.2 = seuil habituel d'alerte batterie faible des OS.
export const LOW_BATTERY_THRESHOLD = 0.2;

// Immobilité : toutes les positions des STATIONARY_WINDOW_MS dernières ms
// tiennent dans un cercle de STATIONARY_RADIUS_M — et l'historique couvre au
// moins toute la fenêtre (sinon "pas encore assez de recul", pas "immobile").
export const STATIONARY_RADIUS_M = 20;
export const STATIONARY_WINDOW_MS = 90 * 1000;

/**
 * Profils d'acquisition. `minIntervalMs` = intervalle minimal entre deux
 * fixes réellement TRAITÉS (store + carte + report position) ; il ne bride
 * pas le capteur, il évite le travail (et les redraws carte) inutiles quand
 * une position quasi identique retombe toutes les secondes.
 */
export const GPS_PROFILES = Object.freeze({
  // Précision max forcée par l'agent (préférence "high").
  high:   Object.freeze({ enableHighAccuracy: true,  maximumAge: 0,     timeout: 15000, minIntervalMs: 0 }),
  // Défaut en mouvement, batterie OK — identique au réglage historique.
  normal: Object.freeze({ enableHighAccuracy: true,  maximumAge: 10000, timeout: 15000, minIntervalMs: 0 }),
  // Batterie faible, immobile, ou économie forcée par l'agent.
  saver:  Object.freeze({ enableHighAccuracy: false, maximumAge: 30000, timeout: 20000, minIntervalMs: 15000 })
});

export const GPS_POWER_PREFERENCES = Object.freeze(["auto", "saver", "high"]);

/**
 * True si les fixes fournis indiquent un agent immobile.
 *
 * @param {Array<{lat:number,lng:number,timestamp:number}>} fixes - historique
 *   récent, ordre chronologique croissant (le plus ancien en premier).
 * @param {object} [opts]
 * @param {number} [opts.radiusM=STATIONARY_RADIUS_M]
 * @param {number} [opts.windowMs=STATIONARY_WINDOW_MS]
 * @returns {boolean}
 */
export function isStationary(fixes, { radiusM = STATIONARY_RADIUS_M, windowMs = STATIONARY_WINDOW_MS } = {}) {
  if (!Array.isArray(fixes) || fixes.length < 2) return false;

  const clean = fixes.filter(f =>
    Number.isFinite(f?.lat) && Number.isFinite(f?.lng) && Number.isFinite(f?.timestamp)
  );
  if (clean.length < 2) return false;

  const last = clean[clean.length - 1];
  const oldest = clean[0];

  // Il faut au moins une fenêtre COMPLÈTE d'observation : sans ça, deux
  // fixes rapprochés à l'ouverture de l'app suffiraient à déclarer
  // "immobile". On mesure le recul sur TOUT l'historique, pas sur le seul
  // sous-ensemble dans la fenêtre (qui, par construction, ne peut jamais
  // s'étendre au-delà de windowMs).
  if (last.timestamp - oldest.timestamp < windowMs) return false;

  const windowStart = last.timestamp - windowMs;
  const inWindow = clean.filter(f => f.timestamp >= windowStart);
  if (inWindow.length < 2) return false;

  const ref = inWindow[0];
  return inWindow.every(f => haversineKm(ref.lat, ref.lng, f.lat, f.lng) * 1000 <= radiusM);
}

/**
 * Choisit le profil d'acquisition GPS.
 *
 * @param {object} input
 * @param {"auto"|"saver"|"high"} [input.preference="auto"] - réglage agent.
 * @param {number|null} [input.batteryLevel=null] - niveau batterie 0–1
 *   (null si l'API Battery n'est pas disponible — cas iOS/Firefox).
 * @param {boolean|null} [input.charging=null] - en charge ?
 * @param {boolean} [input.stationary=false] - sortie de isStationary().
 * @returns {{name:string, reason:string, enableHighAccuracy:boolean,
 *   maximumAge:number, timeout:number, minIntervalMs:number}}
 */
export function resolveGpsProfile({ preference = "auto", batteryLevel = null, charging = null, stationary = false } = {}) {
  if (preference === "high") return { name: "high", reason: "forced-high", ...GPS_PROFILES.high };
  if (preference === "saver") return { name: "saver", reason: "forced-saver", ...GPS_PROFILES.saver };

  const lowBattery =
    Number.isFinite(batteryLevel) && batteryLevel <= LOW_BATTERY_THRESHOLD && charging !== true;

  if (lowBattery) return { name: "saver", reason: "battery-low", ...GPS_PROFILES.saver };
  if (stationary) return { name: "saver", reason: "stationary", ...GPS_PROFILES.saver };
  return { name: "normal", reason: "moving", ...GPS_PROFILES.normal };
}

/** Libellé court pour l'indicateur d'état (voir appView.js). */
export function describeGpsPowerMode(preference, profileName) {
  if (preference === "high") return "GPS précision max";
  if (preference === "saver") return "GPS économie";
  return profileName === "saver" ? "GPS auto · économie" : "GPS auto";
}

const STORAGE_KEY = "anareka.gpsPowerMode";

export function readGpsPowerPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return GPS_POWER_PREFERENCES.includes(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function writeGpsPowerPreference(value) {
  const next = GPS_POWER_PREFERENCES.includes(value) ? value : "auto";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Stockage indisponible (navigation privée) — la préférence ne survivra
    // pas à la session, sans conséquence fonctionnelle.
  }
  return next;
}

/** Fait défiler auto -> saver -> high -> auto (bouton de bascule unique). */
export function nextGpsPowerPreference(current) {
  const i = GPS_POWER_PREFERENCES.indexOf(current);
  return GPS_POWER_PREFERENCES[(i + 1) % GPS_POWER_PREFERENCES.length] || "auto";
}
