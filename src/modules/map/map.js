import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import { CONFIG } from "../../core/config.js";
import { log } from "../../core/debug.js";

const basemapStyle = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      // CARTO Voyager au lieu de tile.openstreetmap.org : le serveur public
      // OSM applique une politique anti-usage-app (rate-limiting / blocage
      // des PWAs) et ses réponses d'erreur n'ont pas d'en-tête CORS, d'où
      // les tempêtes de "TypeError: Failed to fetch". CARTO est conçu pour
      // la production, sert des en-têtes CORS corrects et autorise l'usage
      // applicatif avec attribution. Tuiles servies jusqu'au zoom 20.
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution:
        "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> © <a href=\"https://carto.com/attributions\">CARTO</a>"
    }
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }]
};

let mapInstance = null;
let clusterInstance = null;
let userLocationMarker = null;
let destinationMarker = null;
let heatmapVisible = false;

export function initMap(containerId = "map") {
  const container = document.getElementById(containerId);
  if (!container) return null;

  mapInstance = new maplibregl.Map({
    container: containerId,
    style: basemapStyle,
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
  if (!mapInstance) {
    log.trace("ROUTE", "STOP addRouteLayer: mapInstance null");
    return;
  }

  // addSource/addLayer lèvent une erreur ("Style is not done loading") si le
  // style du fond de carte n'a pas fini de charger — ça peut arriver si un
  // agent clique sur "Itinéraire" tout de suite après l'ouverture de l'app.
  if (!mapInstance.isStyleLoaded()) {
    log.trace("ROUTE", "style pas prêt — ajout de la route différé à 'idle'");
    mapInstance.once("idle", () => addRouteLayer(geojson));
    return;
  }

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

  log.traceAlways("ROUTE",
    `map source="route-line" ajoutée, layer="route-line-layer" ajouté`,
    `${geojson?.coordinates?.length || 0} points de tracé`);
  return { sourceId: "route-line", layerId: "route-line-layer" };
}

// Marqueur "vous êtes ici" — la position GPS était suivie en interne (pour les
// calculs de distance/itinéraire) mais jamais affichée sur la carte, donc un
// agent ne voyait jamais où il se trouvait réellement.
export function showUserLocation(lat, lng) {
  if (!mapInstance) return;
  if (!userLocationMarker) {
    const el = document.createElement("div");
    el.className = "user-location-dot";
    el.innerHTML = '<div class="user-location-pulse"></div><div class="user-location-core"></div>';
    userLocationMarker = new maplibregl.Marker({ element: el, anchor: "center" });
  }
  userLocationMarker.setLngLat([lng, lat]).addTo(mapInstance);
}

export function hideUserLocation() {
  if (userLocationMarker) {
    userLocationMarker.remove();
    userLocationMarker = null;
  }
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

/**
 * Cadre la caméra sur la totalité du tracé d'itinéraire (Problème #5).
 * Sans cela, une route calculée hors du viewport courant restait invisible.
 * @param {{coordinates: [number, number][]}} geometry - LineString GeoJSON
 */
export function fitRouteBounds(geometry) {
  if (!mapInstance || !geometry?.coordinates?.length) {
    log.trace("ROUTE", "STOP fitRouteBounds: geometry vide");
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const c of geometry.coordinates) bounds.extend(c);
  // Padding haut plus grand : laisse la place au bandeau de navigation en bas.
  mapInstance.fitBounds(bounds, {
    padding: { top: 80, bottom: 160, left: 60, right: 60 },
    duration: 800,
    maxZoom: 17
  });
  log.trace("ROUTE", "fitBounds appliqué sur le tracé");
}

/** Marqueur visuel de destination pendant une navigation. */
export function showDestinationMarker(lat, lon) {
  if (!mapInstance || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (!destinationMarker) {
    const el = document.createElement("div");
    el.className = "destination-flag";
    el.textContent = "🎯";
    el.style.fontSize = "30px";
    el.style.textShadow = "0 2px 6px rgba(0,0,0,0.4)";
    destinationMarker = new maplibregl.Marker({ element: el, anchor: "bottom" });
  }
  destinationMarker.setLngLat([lon, lat]).addTo(mapInstance);
}

export function hideDestinationMarker() {
  if (destinationMarker) {
    destinationMarker.remove();
    destinationMarker = null;
  }
}

/**
 * Carte de densité (couche "heatmap" native MapLibre) — vue d'ensemble de
 * la couverture terrain que les marqueurs individuels/clusters ne donnent
 * pas facilement à l'œil : où se concentrent les points RESTANT à visiter,
 * pas juste où se concentrent les points tout court. Les points déjà
 * visités pèsent volontairement peu (poids 0.15) dans le calcul plutôt que
 * d'être exclus : une zone entièrement visitée reste visible en fond
 * (faible intensité) au lieu de disparaître complètement de la carte.
 */
function applyCoverageHeatmapData(points) {
  if (!mapInstance) return;

  const geojson = {
    type: "FeatureCollection",
    features: (points || [])
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => ({
        type: "Feature",
        properties: { weight: p.visited ? 0.15 : 1 },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] }
      }))
  };

  const apply = () => {
    const source = mapInstance.getSource("coverage-heatmap");
    if (source) {
      source.setData(geojson);
      return;
    }

    mapInstance.addSource("coverage-heatmap", { type: "geojson", data: geojson });
    mapInstance.addLayer({
      id: "coverage-heatmap-layer",
      type: "heatmap",
      source: "coverage-heatmap",
      layout: { visibility: heatmapVisible ? "visible" : "none" },
      paint: {
        "heatmap-weight": ["get", "weight"],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 15, 32],
        "heatmap-opacity": 0.75,
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.2, "rgba(46,204,113,0.45)",
          0.4, "rgba(241,196,15,0.6)",
          0.6, "rgba(230,126,34,0.7)",
          0.8, "rgba(231,76,60,0.8)",
          1, "rgba(155,20,20,0.9)"
        ]
      }
    });
  };

  if (!mapInstance.isStyleLoaded()) {
    mapInstance.once("idle", apply);
  } else {
    apply();
  }
}

/**
 * Recalcule les données de la heatmap (à appeler à chaque mise à jour de
 * "points") — sans effet si la couche n'est pas visible, pour ne pas
 * payer le coût de recalcul quand personne ne la regarde.
 */
export function updateCoverageHeatmap(points) {
  if (!heatmapVisible) return;
  applyCoverageHeatmapData(points);
}

export function toggleCoverageHeatmap(points) {
  heatmapVisible = !heatmapVisible;
  applyCoverageHeatmapData(points);
  if (mapInstance?.getLayer("coverage-heatmap-layer")) {
    mapInstance.setLayoutProperty("coverage-heatmap-layer", "visibility", heatmapVisible ? "visible" : "none");
  }
  return heatmapVisible;
}

export function isCoverageHeatmapVisible() {
  return heatmapVisible;
}
