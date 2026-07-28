import L from "leaflet";
import "leaflet.markercluster";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";

let mapInstance = null;
let clusterGroup = null;

export function initMap(containerId = "map") {
  const container = document.getElementById(containerId);
  if (!container) return null;

  mapInstance = L.map(containerId, {
    zoomControl: false,
    attributionControl: false
  }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(mapInstance);

  L.control.attribution({ position: "bottomright" }).addTo(mapInstance);
  L.control.zoom({ position: "bottomright" }).addTo(mapInstance);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 60,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
  });

  mapInstance.addLayer(clusterGroup);

  return mapInstance;
}

export function getMap() {
  return mapInstance;
}

export function getClusterGroup() {
  return clusterGroup;
}

export function flyToPoint(lat, lon, zoom = 17) {
  if (!mapInstance) return;
  mapInstance.flyTo([lat, lon], zoom, { duration: 1.2 });
}

export function fitToBounds(bounds, padding = [40, 40]) {
  if (!mapInstance || !bounds) return;
  mapInstance.fitBounds(bounds, { padding });
}

export function addRouteLayer(geojson) {
  if (!mapInstance) return;
  const layer = L.geoJSON(geojson, {
    style: { color: "#1a3d2b", weight: 5, opacity: 0.8, lineCap: "round" }
  }).addTo(mapInstance);
  return layer;
}

export function clearRouteLayers() {
  if (!mapInstance) return;
  mapInstance.eachLayer(layer => {
    if (layer instanceof L.GeoJSON) {
      mapInstance.removeLayer(layer);
    }
  });
}
