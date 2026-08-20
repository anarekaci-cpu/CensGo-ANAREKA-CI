import { store } from "../../core/store.js";
import { getMap, flyToPoint, showUserLocation } from "../map/map.js";
import { reportPosition } from "./agentTracking.js";
import { haversineKm } from "../../core/geo.js";

let position = null;
let hasAutoCentered = false;

export function initGeolocation() {
  if (!navigator.geolocation) {
    store.set("geo.error", "Géolocalisation non supportée");
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      position = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        timestamp: pos.timestamp
      };
      store.set("geo.position", position);
      store.set("geo.tracking", true);
      store.set("geo.error", null);
      // La position était suivie en interne (distances, itinéraire) mais
      // jamais affichée sur la carte — un agent ne voyait jamais où il était.
      showUserLocation(position.lat, position.lng);
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
  if (!map || !position) return;
  flyToPoint(position.lat, position.lng, 17);
}

export async function findNearestUnvisited() {
  if (!position) return null;

  const points = store.get("points").filter(p => !p.visited);
  if (points.length === 0) return null;

  let nearest = null;
  let minDist = Infinity;

  for (const pt of points) {
    const d = haversineKm(position.lat, position.lng, pt.lat, pt.lon);
    if (d < minDist) {
      minDist = d;
      nearest = { point: pt, distance: d };
    }
  }

  return nearest;
}
