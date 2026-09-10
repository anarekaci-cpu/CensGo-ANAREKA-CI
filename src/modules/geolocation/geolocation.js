import { store } from "../../core/store.js";
import { CONFIG } from "../../core/config.js";
import { getMap, flyToPoint, showUserLocation } from "../map/map.js";
import { reportPosition } from "./agentTracking.js";
import { haversineKm } from "../../core/geo.js";
import { log } from "../../core/debug.js";
import { toastInfo, toastWarning } from "../../core/toast.js";
import { findNearestByRoad } from "../routing/routing.js";
import { shouldAcceptGpsFix, smoothGpsPosition } from "../../core/positionSmoothing.js";
import {
  isStationary,
  resolveGpsProfile,
  describeGpsPowerMode,
  readGpsPowerPreference,
  writeGpsPowerPreference,
  nextGpsPowerPreference,
  STATIONARY_WINDOW_MS
} from "../../core/gpsPowerMode.js";
import { startPassiveHeadingTracking } from "../compass/compass.js";

let position = null;
let displayPosition = null;
let hasAutoCentered = false;
let hasCheckedZoneProximity = false;
let watchId = null;

// === Mode économie de batterie GPS (voir core/gpsPowerMode.js) ===
// Historique brut des fixes récents (positions non lissées) pour la
// détection d'immobilité — borné à la fenêtre utile.
let recentFixes = [];
// Profil d'acquisition actuellement armé sur watchPosition.
let currentProfile = null;
// Dernier fix RÉELLEMENT traité (store/carte/report) — sert au throttle du
// profil "saver".
let lastProcessedAt = 0;
// Préférence agent persistée : "auto" | "saver" | "high".
let powerPreference = readGpsPowerPreference();
// État batterie (null tant que l'API Battery n'a pas répondu, ou absente —
// iOS Safari / Firefox ne l'exposent pas).
let batteryLevel = null;
let batteryCharging = null;
let batteryInit = false;

function gpsProfileInputs() {
  return {
    preference: powerPreference,
    batteryLevel,
    charging: batteryCharging,
    stationary: isStationary(recentFixes)
  };
}

function publishPowerState() {
  store.set("geo.powerMode", powerPreference);
  store.set("geo.powerProfile", currentProfile?.name || "normal");
}

/**
 * (Re)arme watchPosition avec les options du profil fourni. Idempotent tant
 * que le profil ne change pas (comparaison par nom) — appelé après chaque
 * fix traité, à chaque événement batterie et au changement de préférence.
 */
function armWatch(profile) {
  if (!navigator.geolocation) return;
  if (currentProfile && currentProfile.name === profile.name && watchId !== null) return;

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  currentProfile = profile;
  watchId = navigator.geolocation.watchPosition(onGpsFix, onGpsError, {
    enableHighAccuracy: profile.enableHighAccuracy,
    maximumAge: profile.maximumAge,
    timeout: profile.timeout
  });
  publishPowerState();
  log.debug("GPS", `profil d'acquisition = ${profile.name} (${profile.reason})`);
}

function reevaluateProfile() {
  if (watchId === null) return;
  armWatch(resolveGpsProfile(gpsProfileInputs()));
}

function initBatteryWatch() {
  if (batteryInit || typeof navigator === "undefined" || typeof navigator.getBattery !== "function") return;
  batteryInit = true;
  navigator.getBattery().then((b) => {
    const sync = () => {
      batteryLevel = b.level;
      batteryCharging = b.charging;
      reevaluateProfile();
    };
    sync();
    b.addEventListener("levelchange", sync);
    b.addEventListener("chargingchange", sync);
  }).catch(() => {
    // API présente mais refusée (contexte non sécurisé, permissions) — on
    // reste sur le comportement "batterie inconnue" (profil piloté par la
    // seule immobilité + la préférence agent).
  });
}

/**
 * Bascule la préférence agent (auto -> économie -> précision max -> auto),
 * la persiste et réarme immédiatement le watch. Renvoie la nouvelle valeur.
 */
export function cycleGpsPowerMode() {
  return setGpsPowerMode(nextGpsPowerPreference(powerPreference));
}

export function setGpsPowerMode(pref) {
  powerPreference = writeGpsPowerPreference(pref);
  if (watchId !== null) {
    reevaluateProfile();
  } else {
    publishPowerState();
  }
  return powerPreference;
}

export function getGpsPowerMode() {
  return powerPreference;
}

/** Libellé court pour l'indicateur d'état (voir appView.js). */
export function getGpsPowerLabel() {
  return describeGpsPowerMode(powerPreference, currentProfile?.name || "normal");
}

export function initGeolocation() {
  // Publie la préférence persistée dès le démarrage (le bouton d'état
  // l'affiche avant même le premier fix GPS).
  store.set("geo.powerMode", powerPreference);

  // Cône de cap orienté par la boussole du téléphone (Android — passif, sans
  // autorisation). Sur iOS, reste piloté par le cap GPS jusqu'à ce que
  // l'agent ouvre le panneau boussole. Best-effort, jamais bloquant.
  try { startPassiveHeadingTracking(); } catch { /* capteur indisponible */ }

  if (!navigator.geolocation) {
    log.traceAlways("GPS", "navigator.geolocation INDISPONIBLE");
    store.set("geo.error", "Géolocalisation non supportée");
    return;
  }

  initBatteryWatch();
  // Premier armement : historique vide + batterie inconnue => profil
  // "normal", identique au réglage historique { enableHighAccuracy: true,
  // maximumAge: 10000, timeout: 15000 }. Le profil s'ajuste ensuite au fil
  // des fixes (immobilité) et des événements batterie.
  armWatch(resolveGpsProfile(gpsProfileInputs()));
}

/**
 * Ajoute un fix brut à l'historique d'immobilité et le tronque à la fenêtre
 * utile (2× STATIONARY_WINDOW_MS de marge pour lisser les trous de signal).
 */
function recordFix(rawPosition) {
  recentFixes.push({ lat: rawPosition.lat, lng: rawPosition.lng, timestamp: rawPosition.timestamp || Date.now() });
  const cutoff = (rawPosition.timestamp || Date.now()) - STATIONARY_WINDOW_MS * 2;
  if (recentFixes.length > 60 || recentFixes[0].timestamp < cutoff) {
    recentFixes = recentFixes.filter(f => f.timestamp >= cutoff).slice(-60);
  }
}

function onGpsFix(pos) {
  const rawPosition = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    heading: pos.coords.heading,
    timestamp: pos.timestamp
  };

  recordFix(rawPosition);

  // Throttle du profil "saver" : sur batterie faible / à l'arrêt, inutile de
  // repasser par le store, la carte et l'envoi réseau à chaque fix quasi
  // identique. On laisse toujours passer un mouvement franc (>= 25 m) pour
  // réagir immédiatement quand l'agent repart (et sortir de l'immobilité).
  const nowT = rawPosition.timestamp || Date.now();
  const minInterval = currentProfile?.minIntervalMs || 0;
  if (minInterval > 0 && position && lastProcessedAt) {
    const movedM = haversineKm(position.lat, position.lng, rawPosition.lat, rawPosition.lng) * 1000;
    if (nowT - lastProcessedAt < minInterval && movedM < 25) {
      reevaluateProfile();
      return;
    }
  }

  if (!shouldAcceptGpsFix(rawPosition, position)) return;
  lastProcessedAt = nowT;
  position = rawPosition;
  displayPosition = smoothGpsPosition(displayPosition, rawPosition);
  log.debug("GPS", `fix lat=${position.lat} lng=${position.lng} accuracy=${position.accuracy}m`);
  store.set("geo.position", position);
  store.set("geo.tracking", true);
  store.set("geo.error", null);
  // La position était suivie en interne (distances, itinéraire) mais
  // jamais affichée sur la carte — un agent ne voyait jamais où il était.
  showUserLocation(displayPosition.lat, displayPosition.lng, position.accuracy);
  reportPosition(position);

  // La carte s'ouvrait toujours centrée sur Abidjan par défaut, quel que
  // soit l'endroit réel où l'agent travaille. L'app doit fonctionner
  // n'importe où en Côte d'Ivoire (ou ailleurs) : dès la première position
  // GPS reçue, on recentre automatiquement dessus une seule fois, sans
  // continuer à déplacer la caméra à chaque mise à jour ensuite (ce qui
  // gênerait un agent en train de consulter la carte).
  if (!hasAutoCentered) {
    hasAutoCentered = true;
    flyToPoint(position.lat, position.lng, 15);
  }

  // Demandé (agent terrain, lagune d'Abidjan) : prévenir explicitement
  // si l'agent démarre à plus de NEAREST_SEARCH_RADIUS_KM de TOUT point
  // de recensement — pas seulement quand il clique "Point le plus
  // proche" (voir appView.js:nearestBtn, même seuil). Un seul avis par
  // session (pas à chaque fix GPS) ; reporté tant que "points" n'a pas
  // encore chargé (sinon "aucun point" serait interprété à tort comme
  // "zone injoignable" avant même que les données n'arrivent).
  if (!hasCheckedZoneProximity && (store.get("points") || []).length > 0) {
    hasCheckedZoneProximity = true;
    checkZoneProximityOnce();
  }

  // Le mouvement/l'immobilité vient peut-être de changer : ajuste le profil
  // d'acquisition pour le prochain fix.
  reevaluateProfile();
}

function onGpsError(err) {
  console.warn("Géolocalisation erreur:", err);
  store.set("geo.error", describeGeoError(err));
  store.set("geo.tracking", false);
}

export function stopGeolocation() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  position = null;
  displayPosition = null;
  hasAutoCentered = false;
  recentFixes = [];
  currentProfile = null;
  lastProcessedAt = 0;
  store.set("geo.tracking", false);
}

function describeGeoError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    return "Localisation refusée — autorisez l'accès à la position dans les réglages du navigateur.";
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return "Position GPS indisponible pour le moment.";
  }
  if (err.code === err.TIMEOUT) {
    return "Délai dépassé pour obtenir la position GPS.";
  }
  return err.message || "Erreur de géolocalisation.";
}

export function getCurrentPosition() {
  return position;
}

export function locateAndCenter() {
  const map = getMap();
  if (!map) return;
  // BUG (signalé) : sans position GPS, cette fonction ne faisait RIEN — un
  // agent qui tapait "Me localiser" juste après l'ouverture de l'app (avant
  // le premier fix GPS, ou permission refusée) ne voyait aucune réaction du
  // tout, ce qui se lit comme "la localisation ne marche pas".
  if (!position) {
    const error = store.get("geo.error");
    if (error) {
      toastWarning(error);
    } else {
      toastInfo("Recherche de votre position GPS en cours…");
    }
    return;
  }
  flyToPoint(position.lat, position.lng, 17);
}

// Nombre de candidats (les plus proches à vol d'oiseau) soumis au calcul de
// distance ROUTÉE réelle — voir findNearestByRoad() (routing.js). Assez
// large pour couvrir un détour routier réaliste autour d'un obstacle
// (lagune, fleuve — fréquent à Abidjan) sans dépasser la limite pratique de
// coordonnées du service OSRM /table public.
//
// BUG CONFIRMÉ EN TERRAIN (trois audits distincts, dont deux captures
// d'écran) : un premier correctif limitait ce pool à 12, avec un second pool
// élargi à 40 tenté SEULEMENT si les 12 étaient TOUS inatteignables. Ça
// ratait le cas réellement vécu : les 12 (puis les 40) candidats les plus
// proches à vol d'oiseau étaient bien atteignables (par un long détour),
// donc aucun élargissement ne se déclenchait jamais — alors qu'un point
// réellement plus proche PAR LA ROUTE (ex: de l'autre côté d'un pont
// proche) existait, mais classé au-delà du rang 12 (puis 40) à vol
// d'oiseau, jamais soumis au calcul de distance routée. Le même schéma
// s'est reproduit à 40 dans une zone très dense (village d'Abatta,
// Bingerville — des dizaines de points recensés sur quelques centaines de
// mètres) : le pool ne "voyait" jamais le point le plus proche par la
// route, classé trop loin à vol d'oiseau par la seule densité locale.
// Élargi à 80 — reste largement dans les limites pratiques d'OSRM /table
// et de la Matrix API ORS (un seul appel réseau, pas un par candidat). Ce
// n'est pas une solution définitive (une zone encore plus dense pourrait
// reproduire le même problème) mais un pool deux fois plus large réduit
// fortement la fréquence du cas — voir aussi le commentaire de
// findNearestByRoad() (routing.js) pour la bascule ORS/OSRM elle-même.
const ROAD_DISTANCE_CANDIDATE_COUNT = 80;

/**
 * BUG CONFIRMÉ EN TERRAIN (audit) : le "plus proche" était calculé à vol
 * d'oiseau — près d'une lagune/d'un fleuve, un point de l'autre côté de
 * l'eau paraît "proche" alors qu'il faut faire tout le tour par le pont ;
 * l'agent passait alors devant des dizaines d'autres points non-visités
 * réellement plus proches PAR LA ROUTE. On présélectionne maintenant les
 * N points les plus proches à vol d'oiseau (rapide, local, aucune requête
 * réseau) puis on les départage par distance routée réelle
 * (findNearestByRoad(), OSRM /table). Repli sur le vol d'oiseau pur
 * seulement si la requête échoue entièrement (hors-ligne, timeout, aucun
 * point du tout atteignable) — jamais de blocage total de la fonctionnalité.
 *
 * @param {object[]} [candidatePoints] - si fourni, restreint la recherche à
 * cet ensemble (voir appView.js: nearestBtn, qui y passe les points
 * respectant les filtres actifs — ville/quartier/bloc/statut/recherche —
 * pour permettre à un agent de dire "le plus proche DANS cette zone" plutôt
 * que sur l'ensemble du recensement). Par défaut (absent), tous les points
 * chargés (store "points"), comme avant.
 */
export async function findNearestUnvisited(candidatePoints) {
  if (!position) return null;

  const points = (candidatePoints || store.get("points")).filter(p => !p.visited);
  if (points.length === 0) return null;

  const byStraightLine = points
    .map(pt => ({ point: pt, distance: haversineKm(position.lat, position.lng, pt.lat, pt.lon) }))
    .sort((a, b) => a.distance - b.distance);

  // Diagnostic terrain (toujours affiché) : voir le commentaire équivalent
  // dans findNearestByRoad() (routing.js) — sans ce point d'entrée du
  // classement à vol d'oiseau, impossible de savoir si un signalement
  // "mauvais point le plus proche" vient d'un mauvais pré-filtrage ici ou
  // d'un choix erroné une fois les distances routées connues.
  log.traceAlways("GPS",
    `findNearestUnvisited : position=(${position.lat.toFixed(5)},${position.lng.toFixed(5)}), ${points.length} point(s) non visité(s) au total`,
    "top 5 à vol d'oiseau :",
    byStraightLine.slice(0, 5).map(c => ({ id: c.point.id, name: c.point.name, distanceKm: c.distance.toFixed(2) }))
  );

  // Signalé par un agent terrain (audit) : "le plus proche" pouvait être à
  // 10+ km de route réelle (recensement réparti sur plusieurs villes/zones
  // séparées par la lagune à Abidjan) — présenté sans nuance, ça ressemble à
  // un point "juste à côté" et rend l'app inutilisable à pied/vélo depuis
  // cette position. On annote maintenant le résultat (withinRadius) au lieu
  // de le cacher : le point reste utile (ex: prévoir un déplacement en
  // véhicule), mais l'appelant (voir appView.js: nearestBtn) doit avertir
  // clairement plutôt que suggérer une proximité immédiate inexistante.
  const withRadiusFlag = (point, distanceKm) => ({
    point,
    distance: distanceKm,
    withinRadius: distanceKm <= CONFIG.NEAREST_SEARCH_RADIUS_KM
  });

  const candidates = byStraightLine.slice(0, ROAD_DISTANCE_CANDIDATE_COUNT);
  try {
    const best = await findNearestByRoad(position.lat, position.lng, candidates.map(c => c.point));
    if (best) {
      return withRadiusFlag(candidates[best.index].point, best.distanceM / 1000);
    }
  } catch (err) {
    log.warn("GPS", "findNearestByRoad() indisponible, repli sur le vol d'oiseau:", err?.message || err);
  }

  // Repli : hors-ligne, timeout, ou aucun candidat (même parmi les
  // ROAD_DISTANCE_CANDIDATE_COUNT) atteignable par la route connue —
  // le plus proche à vol d'oiseau reste préférable à rien.
  log.traceAlways("GPS", "findNearestUnvisited : repli sur le plus proche à vol d'oiseau (aucun candidat routé disponible)");
  if (!byStraightLine[0]) return null;
  return withRadiusFlag(byStraightLine[0].point, byStraightLine[0].distance);
}

/**
 * Alerte proactive "zone de recensement trop loin" — une seule fois par
 * session, sur TOUS les points (pas les filtres actifs, contrairement à
 * l'appel filtré de appView.js:nearestBtn) : si l'agent démarre à plus de
 * NEAREST_SEARCH_RADIUS_KM du point non-visité le plus proche PAR LA ROUTE,
 * ça vaut la peine de le dire avant même qu'il ne cherche à recenser quoi
 * que ce soit, plutôt que de le laisser découvrir le problème plus tard.
 */
async function checkZoneProximityOnce() {
  try {
    const res = await findNearestUnvisited();
    if (res && !res.withinRadius) {
      const zone = res.point.quartier || res.point.city || "une autre zone";
      toastWarning(
        `Vous êtes trop loin de la zone de recensement (${res.distance.toFixed(1)} km du point le plus proche). ` +
        `Déplacez-vous vers ${zone} ou utilisez le filtre ville/quartier pour explorer une autre zone.`
      );
    }
  } catch (err) {
    log.warn("GPS", "checkZoneProximityOnce() échoué:", err?.message || err);
  }
}
