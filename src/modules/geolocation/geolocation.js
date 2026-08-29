import { store } from "../../core/store.js";
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
const ROAD_DISTANCE_CANDIDATE_COUNT = 12;

// BUG CONFIRMÉ EN TERRAIN (nouvel audit, retour utilisateur avec capture
// d'écran) : la présélection à ROAD_DISTANCE_CANDIDATE_COUNT (12) résout le
// cas courant, mais échoue encore quand les 12 points les plus proches À VOL
// D'OISEAU sont TOUS de l'autre côté d'un obstacle (lagune sans pont piéton
// proche) — findNearestByRoad() renvoie alors `null` pour chacun d'eux
// (aucun n'est atteignable dans le graphe piéton d'OSRM), la fonction
// retombait directement sur byStraightLine[0], c'est-à-dire EXACTEMENT le
// point-au-vol-d'oiseau que ce correctif est censé éviter (dans le cas vécu :
// un point à 20+ km / 4h de marche affiché comme "le plus proche" alors que
// des dizaines d'autres points étaient visibles bien plus près sur la carte,
// simplement hors du pool des 12 plus proches à vol d'oiseau). Un second
// pool, élargi, n'est tenté QUE si le premier échoue entièrement — le cas
// courant (candidat trouvé dans les 12) ne coûte donc toujours qu'UNE seule
// requête OSRM, comme avant.
const ROAD_DISTANCE_CANDIDATE_COUNT_WIDE = 40;

/**
 * BUG CONFIRMÉ EN TERRAIN (audit) : le "plus proche" était calculé à vol
 * d'oiseau — près d'une lagune/d'un fleuve, un point de l'autre côté de
 * l'eau paraît "proche" alors qu'il faut faire tout le tour par le pont ;
 * l'agent passait alors devant des dizaines d'autres points non-visités
 * réellement plus proches PAR LA ROUTE. On présélectionne maintenant les
 * N points les plus proches à vol d'oiseau (rapide, local, aucune requête
 * réseau) puis on les départage par distance routée réelle
 * (findNearestByRoad(), OSRM /table) — en élargissant le pool si le premier
 * essai n'a trouvé AUCUN candidat atteignable (voir
 * ROAD_DISTANCE_CANDIDATE_COUNT_WIDE ci-dessus). Repli sur le vol d'oiseau
 * pur seulement si toutes les tentatives échouent (hors-ligne, timeout,
 * aucun point du tout atteignable) — jamais de blocage total de la
 * fonctionnalité.
 */
export async function findNearestUnvisited() {
  if (!position) return null;

  const points = store.get("points").filter(p => !p.visited);
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

  for (const count of [ROAD_DISTANCE_CANDIDATE_COUNT, ROAD_DISTANCE_CANDIDATE_COUNT_WIDE]) {
    const candidates = byStraightLine.slice(0, count);
    try {
      const best = await findNearestByRoad(position.lat, position.lng, candidates.map(c => c.point));
      if (best) {
        return { point: candidates[best.index].point, distance: best.distanceM / 1000 };
      }
    } catch (err) {
      log.warn("GPS", "findNearestByRoad() indisponible, repli sur le vol d'oiseau:", err?.message || err);
      break; // requête réellement indisponible (hors-ligne...) : élargir ne changera rien
    }
  }

  // Repli : hors-ligne, timeout, ou aucun candidat (même parmi les 40)
  // atteignable par la route connue d'OSRM — le plus proche à vol d'oiseau
  // reste préférable à rien, mais ce cas doit désormais être rarissime.
  log.traceAlways("GPS", "findNearestUnvisited : repli sur le plus proche à vol d'oiseau (aucun candidat routé disponible)");
  return byStraightLine[0] || null;
}
