import { store } from "../../core/store.js";
import { CONFIG } from "../../core/config.js";
import { getMap, flyToPoint, showUserLocation } from "../map/map.js";
import { reportPosition } from "./agentTracking.js";
import { haversineKm } from "../../core/geo.js";
import { log } from "../../core/debug.js";
import { toastInfo, toastWarning } from "../../core/toast.js";
import { findNearestByRoad } from "../routing/routing.js";
import { shouldAcceptGpsFix, smoothGpsPosition } from "../../core/positionSmoothing.js";

let position = null;
let displayPosition = null;
let hasAutoCentered = false;
let hasCheckedZoneProximity = false;
let watchId = null;

export function initGeolocation() {
  if (!navigator.geolocation) {
    log.traceAlways("GPS", "navigator.geolocation INDISPONIBLE");
    store.set("geo.error", "Géolocalisation non supportée");
    return;
  }

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const rawPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        timestamp: pos.timestamp
      };
      if (!shouldAcceptGpsFix(rawPosition, position)) return;
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
    },
    (err) => {
      console.warn("Géolocalisation erreur:", err);
      store.set("geo.error", describeGeoError(err));
      store.set("geo.tracking", false);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

export function stopGeolocation() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  position = null;
  displayPosition = null;
  hasAutoCentered = false;
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
// BUG CONFIRMÉ EN TERRAIN (deux audits distincts, dont une capture d'écran) :
// un premier correctif limitait ce pool à 12, avec un second pool élargi à 40
// tenté SEULEMENT si les 12 étaient TOUS inatteignables. Ça ratait le cas
// réellement vécu : les 12 candidats les plus proches à vol d'oiseau étaient
// bien atteignables (par un long détour), donc aucun élargissement ne se
// déclenchait jamais — alors qu'un point réellement plus proche PAR LA ROUTE
// (ex: de l'autre côté d'un pont proche) existait, mais classé au-delà du
// rang 12 à vol d'oiseau, jamais soumis au calcul de distance routée. On
// interroge donc directement ce pool large en un seul essai — findNearestByRoad()
// a déjà démontré qu'il fonctionne à cette taille (c'était l'ancien repli).
const ROAD_DISTANCE_CANDIDATE_COUNT = 40;

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
