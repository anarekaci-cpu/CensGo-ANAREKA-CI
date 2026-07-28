import { store } from "../../core/store.js";
import { getMap, flyToPoint } from "../map/map.js";

let watchId = null;
let position = null;

export function initGeolocation() {
  if (!navigator.geolocation) {
    store.set("geo.error", "Géolocalisation non supportée");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
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
    },
    (err) => {
      console.warn("Géolocalisation erreur:", err);
      store.set("geo.error", err.message);
      store.set("geo.tracking", false);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

export function stopGeolocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  store.set("geo.tracking", false);
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
