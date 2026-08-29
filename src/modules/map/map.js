import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { CONFIG } from "../../core/config.js";
import { log } from "../../core/debug.js";
import { destinationPoint } from "../../core/geo.js";
import { store } from "../../core/store.js";
import { calculateRoutePadding } from "../../core/routeView.js";
import { getEffectiveTheme } from "../../core/theme.js";

// CARTO Voyager au lieu de tile.openstreetmap.org : le serveur public OSM
// applique une politique anti-usage-app (rate-limiting / blocage des PWAs)
// et ses réponses d'erreur n'ont pas d'en-tête CORS, d'où les tempêtes de
// "TypeError: Failed to fetch".
//
// BUG CORRIGÉ (audit terrain, capture d'écran à l'appui) : l'ancien style
// pointait vers {a,b,c}.basemaps.cartocdn.com/rastertiles/voyager/... — ce
// CDN de tuiles RASTER "legacy" a depuis été fermé par CARTO et renvoie
// désormais une image "API KEY REQUIRED" sur CHAQUE tuile (carte
// entièrement illisible en production). Le style GL VECTEUR ci-dessous
// (basemaps.cartocdn.com/gl/voyager-gl-style/...) reste gratuit et sans clé
// à ce jour — vérifié manuellement avant ce correctif. MapLibre GL (déjà
// une dépendance du projet) le consomme nativement via une simple URL de
// style, sans configuration de tuiles/sources manuelle.
const BASEMAP_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
// Variante sombre CARTO — même famille de tuiles vectorielles gratuites
// (carto.streets), vérifiée manuellement avant ce correctif. Sans elle, le
// thème nuit de l'app (voir core/theme.js) laissait le fond de carte lui-même
// intégralement clair — la seule partie de l'écran qui ne suivait pas le choix
// de thème de l'agent.
const DARK_BASEMAP_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

let mapInstance = null;
let clusterInstance = null;
let userLocationMarker = null;
let destinationMarker = null;
let heatmapVisible = false;
let cameraFollowEnabled = true;

export function initMap(containerId = "map") {
  const container = document.getElementById(containerId);
  if (!container) return null;

  mapInstance = new maplibregl.Map({
    container: containerId,
    style: getEffectiveTheme() === "dark" ? DARK_BASEMAP_STYLE_URL : BASEMAP_STYLE_URL,
    center: [CONFIG.MAP_CENTER[1], CONFIG.MAP_CENTER[0]],
    zoom: CONFIG.MAP_ZOOM,
    maxZoom: CONFIG.MAP_MAX_ZOOM,
    attributionControl: false
  });
  mapInstance.on("dragstart", () => {
    cameraFollowEnabled = false;
  });

  mapInstance.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    "bottom-right"
  );
  // customAttribution explicite : ne pas dépendre de ce que le style GL
  // distant choisit (ou non) de déclarer sur sa source — l'obligation
  // d'attribution OSM/CARTO ne doit pas dépendre d'un tiers.
  mapInstance.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> © <a href=\"https://carto.com/attributions\">CARTO</a>"
    }),
    "bottom-right"
  );
  // Échelle de distance : repère visuel direct ("cette barre = 100 m") pour
  // estimer une distance à pied sur la carte sans ouvrir un itinéraire.
  mapInstance.addControl(
    new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
    "bottom-left"
  );

  // minPoints très élevé => les points ne fusionnent JAMAIS en bulle "N
  // points" : chaque point reste son propre marqueur, visible individuellement
  // à n'importe quel niveau de zoom (y compris dézoomé sur toute la zone).
  // Supercluster est conservé (index spatial + rendu uniquement des points
  // dans le viewport courant, indispensable avec 500+ points), seule la
  // FUSION visuelle en bulles est désactivée.
  clusterInstance = new Supercluster({ radius: 60, maxZoom: 17, minPoints: Infinity });

  return mapInstance;
}

export function getMap() { return mapInstance; }

/**
 * Bascule le fond de carte clair/sombre en direct (voir core/theme.js:
 * toggleTheme(), appelé depuis le bouton lune/soleil du header). setStyle()
 * remplace TOUTES les sources/couches personnalisées (itinéraire, cercle de
 * précision GPS, heatmap de couverture) — les DOM Marker (points recensés,
 * position agent, destination) n'en font pas partie et survivent tels
 * quels. On réapplique donc juste ces trois couches après le rechargement
 * du style, à partir de l'état déjà connu du store — pas besoin de refaire
 * de calcul, seulement de redessiner.
 * @param {"dark"|"light"} theme
 */
export function setMapTheme(theme) {
  if (!mapInstance) return;
  const nextUrl = theme === "dark" ? DARK_BASEMAP_STYLE_URL : BASEMAP_STYLE_URL;
  const wasHeatmapVisible = heatmapVisible;
  const route = store.get("navigation.route");
  const mode = store.get("navigation.mode");
  const pos = store.get("geo.position");

  mapInstance.once("style.load", () => {
    if (wasHeatmapVisible) updateCoverageHeatmap(store.get("points"));
    if (route?.geometry) addRouteLayer(route.geometry, mode);
    if (pos) showUserLocation(pos.lat, pos.lng, pos.accuracy);
  });
  mapInstance.setStyle(nextUrl);
}
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

/**
 * Style du tracé par mode : le trait plein (route/vélo) et le tracé piéton
 * doivent se distinguer d'un coup d'œil sur la carte, sans dépendre du
 * bandeau de navigation.
 *
 * Piéton (audit UX) : le tireté net à bouts carrés ("line-cap: butt" +
 * dasharray [0.4, 1.6], grand écart entre de très fins segments) donnait un
 * résultat qui a été signalé comme peu esthétique — des traits épars plutôt
 * qu'un tracé lisible. Remplacé par une ligne de points ronds régulièrement
 * espacés ("line-cap: round" + dasharray [0, 1.8] : un dash de longueur 0
 * avec un bout rond dessine un simple point), le même langage visuel que
 * les itinéraires piétons de Google/Apple Maps — immédiatement reconnu
 * comme "à pied" sans être moins lisible que le trait plein vélo/véhicule.
 */
const ROUTE_LINE_STYLES = {
  foot: { "line-color": "#f97316", "line-width": 6, "line-opacity": 0.95, "line-dasharray": [0, 1.8], "line-cap": "round" },
  bike: { "line-color": "#0284c7", "line-width": 5.5, "line-opacity": 0.95, "line-cap": "round" },
  car: { "line-color": "#dc2626", "line-width": 5.5, "line-opacity": 0.95, "line-cap": "round" }
};

export function addRouteLayer(geojson, mode) {
  if (!mapInstance) {
    log.trace("ROUTE", "STOP addRouteLayer: mapInstance null");
    return;
  }

  // addSource/addLayer lèvent une erreur ("Style is not done loading") si le
  // style du fond de carte n'a pas fini de charger — ça peut arriver si un
  // agent clique sur "Itinéraire" tout de suite après l'ouverture de l'app.
  if (!mapInstance.isStyleLoaded()) {
    log.trace("ROUTE", "style pas prêt — ajout de la route différé à 'idle'");
    mapInstance.once("idle", () => addRouteLayer(geojson, mode));
    return;
  }

  if (mapInstance.getLayer("route-line-layer")) {
    mapInstance.removeLayer("route-line-layer");
  }
  if (mapInstance.getLayer("route-line-casing")) {
    mapInstance.removeLayer("route-line-casing");
  }
  if (mapInstance.getSource("route-line")) {
    mapInstance.removeSource("route-line");
  }

  const { "line-cap": lineCap, ...paint } = ROUTE_LINE_STYLES[mode] || ROUTE_LINE_STYLES.car;

  mapInstance.addSource("route-line", { type: "geojson", data: geojson });
  mapInstance.addLayer({
    id: "route-line-casing",
    type: "line",
    source: "route-line",
    layout: { "line-cap": lineCap, "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": paint["line-width"] + 4, "line-opacity": 0.9 }
  });
  mapInstance.addLayer({
    id: "route-line-layer",
    type: "line",
    source: "route-line",
    layout: { "line-cap": lineCap, "line-join": "round" },
    paint
  });

  log.traceAlways("ROUTE",
    `map source="route-line" ajoutée, layer="route-line-layer" ajouté (mode=${mode || "car"})`,
    `${geojson?.coordinates?.length || 0} points de tracé`);
  return { sourceId: "route-line", layerId: "route-line-layer" };
}

// Rayon maximal affiché pour le cercle de précision GPS : au-delà, le
// cercle deviendrait un gros disque sans intérêt visuel (et énorme à faible
// zoom) — l'important est de signaler une imprécision significative, pas de
// représenter fidèlement un rayon de plusieurs centaines de mètres.
const MAX_ACCURACY_CIRCLE_M = 150;

function accuracyCirclePolygon(lat, lon, radiusMeters, steps = 48) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (360 * i) / steps;
    const p = destinationPoint(lat, lon, bearing, radiusMeters);
    coords.push([p.lon, p.lat]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

function updateAccuracyCircle(lat, lng, accuracy) {
  if (!mapInstance) return;

  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    removeAccuracyCircle();
    return;
  }

  const radius = Math.min(accuracy, MAX_ACCURACY_CIRCLE_M);
  const data = accuracyCirclePolygon(lat, lng, radius);

  const apply = () => {
    const source = mapInstance.getSource("user-accuracy");
    if (source) {
      source.setData(data);
      return;
    }
    mapInstance.addSource("user-accuracy", { type: "geojson", data });
    // Insérée avant le marqueur DOM (les Marker maplibregl flottent toujours
    // au-dessus des layers de style) — ordre sans effet sur le rendu ici,
    // mais garde route-line-layer visuellement au-dessus si les deux
    // coexistent (itinéraire calculé alors que le suivi GPS est actif).
    mapInstance.addLayer({
      id: "user-accuracy-fill",
      type: "fill",
      source: "user-accuracy",
      paint: { "fill-color": "#1a73e8", "fill-opacity": 0.12 }
    });
    mapInstance.addLayer({
      id: "user-accuracy-outline",
      type: "line",
      source: "user-accuracy",
      paint: { "line-color": "#1a73e8", "line-width": 1.5, "line-opacity": 0.35 }
    });
  };

  if (!mapInstance.isStyleLoaded()) {
    mapInstance.once("idle", apply);
  } else {
    apply();
  }
}

function removeAccuracyCircle() {
  if (!mapInstance) return;
  if (mapInstance.getLayer("user-accuracy-fill")) mapInstance.removeLayer("user-accuracy-fill");
  if (mapInstance.getLayer("user-accuracy-outline")) mapInstance.removeLayer("user-accuracy-outline");
  if (mapInstance.getSource("user-accuracy")) mapInstance.removeSource("user-accuracy");
}

// Marqueur "vous êtes ici" — la position GPS était suivie en interne (pour les
// calculs de distance/itinéraire) mais jamais affichée sur la carte, donc un
// agent ne voyait jamais où il se trouvait réellement.
//
// @param {number} lat
// @param {number} lng
// @param {number} [accuracy] rayon de précision GPS en mètres (pos.coords.accuracy)
// — dessine un cercle réel autour du point pour que l'agent VOIE à quel
// point sa position est fiable, au lieu d'un point unique qui donne
// l'illusion d'une localisation exacte même quand elle ne l'est pas.
export function showUserLocation(lat, lng, accuracy) {
  if (!mapInstance) return;
  if (!userLocationMarker) {
    const el = document.createElement("div");
    el.className = "user-location-dot";
    el.innerHTML = '<div class="user-location-pulse"></div><div class="user-location-core"></div>';
    userLocationMarker = new maplibregl.Marker({ element: el, anchor: "center" });
  }
  userLocationMarker.setLngLat([lng, lat]).addTo(mapInstance);
  updateAccuracyCircle(lat, lng, accuracy);
  if (cameraFollowEnabled && store.get("navigation.active")) {
    const heading = store.get("geo.position")?.heading;
    const mapHeight = mapInstance.getContainer().getBoundingClientRect().height;
    mapInstance.easeTo({
      center: [lng, lat],
      zoom: Math.max(mapInstance.getZoom(), 16.5),
      bearing: Number.isFinite(heading) ? heading : mapInstance.getBearing(),
      padding: { top: 0, right: 0, bottom: Math.round(mapHeight * 0.22), left: 0 },
      duration: 450,
      essential: true
    });
  }
}

export function enableCameraFollow() {
  cameraFollowEnabled = true;
}

export function hideUserLocation() {
  if (userLocationMarker) {
    userLocationMarker.remove();
    userLocationMarker = null;
  }
  removeAccuracyCircle();
}

export function clearRouteLayers() {
  if (!mapInstance) return;
  if (mapInstance.getLayer("route-line-layer")) {
    mapInstance.removeLayer("route-line-layer");
  }
  if (mapInstance.getLayer("route-line-casing")) {
    mapInstance.removeLayer("route-line-casing");
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
  const mapElement = mapInstance.getContainer();
  const infoPanel = document.getElementById("navBottomStack");
  const mapRect = mapElement.getBoundingClientRect();
  const panelRect = infoPanel?.getBoundingClientRect();
  const bottomObstruction = calculateRoutePadding(mapRect, panelRect);
  mapInstance.fitBounds(bounds, {
    padding: { top: 80, bottom: bottomObstruction, left: 60, right: 60 },
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
