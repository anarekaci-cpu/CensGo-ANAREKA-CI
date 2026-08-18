import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import { CONFIG } from "../../core/config.js";

const osmStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};

let mapInstance = null;
let clusterInstance = null;

export function initMap(containerId = "map") {
  const container = document.getElementById(containerId);
  if (!container) return null;

  mapInstance = new maplibregl.Map({
    container: containerId,
    style: osmStyle,
    center: [CONFIG.MAP_CENTER[1], CONFIG.MAP_CENTER[0]],
    zoom: CONFIG.MAP_ZOOM,
    maxZoom: CONFIG.MAP_MAX_ZOOM,
    attributionControl: false
  });

  mapInstance.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    "bottom-right"
  );
  mapInstance.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right"
  );

  clusterInstance = new Supercluster({ radius: 60, maxZoom: 17 });

  return mapInstance;
}

export function getMap() { return mapInstance; }
export function getClusterGroup() { return clusterInstance; }

export function flyToPoint(lat, lon, zoom = 17) {
  if (!mapInstance) return;
  mapInstance.flyTo({ center: [lon, lat], zoom, duration: 1200 });
}

export function fitToBounds(bounds, padding = [40, 40]) {
  if (!mapInstance || !bounds) return;
  const [[west, south], [east, north]] = bounds;
  const llb = new maplibregl.LngLatBounds([west, south], [east, north]);
  mapInstance.fitBounds(llb, { padding: { top: padding[0], bottom: padding[0], left: padding[1], right: padding[1] } });
}

export function addRouteLayer(geojson) {
  if (!mapInstance) return;

  if (mapInstance.getLayer("route-line-layer")) {
    mapInstance.removeLayer("route-line-layer");
  }
  if (mapInstance.getSource("route-line")) {
    mapInstance.removeSource("route-line");
  }

  mapInstance.addSource("route-line", { type: "geojson", data: geojson });
  mapInstance.addLayer({
    id: "route-line-layer",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1a3d2b", "line-width": 5, "line-opacity": 0.8 }
  });

  return { sourceId: "route-line", layerId: "route-line-layer" };
}

export function clearRouteLayers() {
  if (!mapInstance) return;
  if (mapInstance.getLayer("route-line-layer")) {
    mapInstance.removeLayer("route-line-layer");
  }
  if (mapInstance.getSource("route-line")) {
    mapInstance.removeSource("route-line");
  }
}
