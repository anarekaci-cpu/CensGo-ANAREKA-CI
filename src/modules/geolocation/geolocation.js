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

export function initGeolocation() {
  if (!navigator.geolocation) {
    log.traceAlways("GPS", "navigator.geolocation INDISPONIBLE");
    store.set("geo.error", "Géolocalisation non supportée");
    return;
  }

  navigator.geolocation.watchPosition(
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

/**
 * BUG CONFIRMÉ EN TERRAIN (audit) : le "plus proche" était calculé à vol
 * d'oiseau — près d'une lagune/d'un fleuve, un point de l'autre côté de
 * l'eau paraît "proche" alors qu'il faut faire tout le tour par le pont ;
 * l'agent passait alors devant des dizaines d'autres points non-visités
 * réellement plus proches PAR LA ROUTE. On présélectionne maintenant les
 * ROAD_DISTANCE_CANDIDATE_COUNT points les plus proches à vol d'oiseau
 * (rapide, local, aucune requête réseau) puis on les départage par distance
 * routée réelle (findNearestByRoad(), OSRM /table). Repli automatique sur
 * le vol d'oiseau pur si la requête échoue (hors-ligne, timeout) — jamais
 * de blocage total de la fonctionnalité.
 */
export async function findNearestUnvisited() {
  if (!position) return null;

  const points = store.get("points").filter(p => !p.visited);
  if (points.length === 0) return null;

  const byStraightLine = points
    .map(pt => ({ point: pt, distance: haversineKm(position.lat, position.lng, pt.lat, pt.lon) }))
    .sort((a, b) => a.distance - b.distance);

  const candidates = byStraightLine.slice(0, ROAD_DISTANCE_CANDIDATE_COUNT);

  try {
    const best = await findNearestByRoad(position.lat, position.lng, candidates.map(c => c.point));
    if (best) {
      return { point: candidates[best.index].point, distance: best.distanceM / 1000 };
    }
  } catch (err) {
    log.warn("GPS", "findNearestByRoad() indisponible, repli sur le vol d'oiseau:", err?.message || err);
  }

  // Repli : hors-ligne, timeout, ou aucun candidat atteignable par la route
  // connue d'OSRM — le plus proche à vol d'oiseau reste préférable à rien.
  return byStraightLine[0] || null;
}
