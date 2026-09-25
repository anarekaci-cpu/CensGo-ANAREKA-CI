/**
 * Renderer de marqueurs WebGL NATIF — alternative au pool de marqueurs DOM
 * de markers.js (opt-in : CONFIG.ENABLE_WEBGL_MARKERS / VITE_ENABLE_WEBGL_MARKERS).
 *
 * Pourquoi : un marqueur DOM = un <div> + un SVG par point visible. Au-delà
 * de quelques milliers de points à l'écran, le coût layout/paint du
 * navigateur fait chuter le défilement de la carte sous 60 FPS et la
 * mémoire grimpe. Des couches `circle` + le clustering NATIF de MapLibre
 * (source geojson `cluster: true`) rendent tout côté GPU : le nombre de
 * points cesse d'être un facteur.
 *
 * Le popup (contenu + actions Itinéraire/Visité/Éditer) est RÉUTILISÉ tel
 * quel depuis markers.js (buildPopup) : mêmes handlers, mêmes garde-fous
 * anti-fraude, même modèle de données. Seuls le rendu des points et
 * l'ouverture du popup changent.
 *
 * Import de buildPopup depuis markers.js : cycle ESM assumé (markers.js
 * importe ce module pour l'aiguillage). buildPopup est une déclaration de
 * fonction (hoistée) et n'est appelée qu'à l'exécution — jamais au chargement
 * du module — donc le cycle est sûr.
 */

import * as maplibregl from "maplibre-gl";
import { store } from "../../core/store.js";
import { getMap } from "../map/map.js";
import { normalizePointId } from "../../core/utils.js";
import { log } from "../../core/debug.js";
import { toGeoJSONCoordinates } from "../../core/geo.js";
import {
  pointsToFeatureCollection,
  statusColorExpression,
  boundsFromFeatureCollection
} from "../../core/markerGeo.js";
import { buildPopup } from "./markers.js";

const SRC = "census-src";
const L_CLUSTER = "census-clusters";
const L_CLUSTER_COUNT = "census-cluster-count";
const L_POINT = "census-points";

let installed = false;
let lastPoints = [];
let currentPopup = null;
let currentPopupId = null;

function pendingSet() {
  return new Set((store.get("sync.pendingPointIds") || []).map(normalizePointId));
}

/**
 * FeatureCollection de l'ensemble actuellement rendu (dernier `points`
 * transmis par l'appelant — donc déjà filtré), MAIS avec chaque point relu
 * depuis le store : un toggle "visité" change l'objet dans le store sans que
 * l'appelant re-transmette forcément la liste filtrée.
 */
function currentFc() {
  const byId = new Map((store.get("points") || []).map(p => [normalizePointId(p.id), p]));
  const fresh = lastPoints.map(p => byId.get(normalizePointId(p.id)) || p);
  return pointsToFeatureCollection(fresh, { pendingIds: pendingSet() });
}

function ensureLayers(map) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: 16
    });
  }
  if (!map.getLayer(L_CLUSTER)) {
    map.addLayer({
      id: L_CLUSTER, type: "circle", source: SRC, filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1a3d2b",
        "circle-opacity": 0.9,
        "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 30],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    });
  }
  if (!map.getLayer(L_CLUSTER_COUNT)) {
    map.addLayer({
      id: L_CLUSTER_COUNT, type: "symbol", source: SRC, filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular", "Open Sans Regular"]
      },
      paint: { "text-color": "#ffffff" }
    });
  }
  if (!map.getLayer(L_POINT)) {
    map.addLayer({
      id: L_POINT, type: "circle", source: SRC, filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": statusColorExpression(),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 6, 17, 9],
        "circle-opacity": ["case", ["get", "visited"], 0.45, 0.95],
        "circle-stroke-width": ["case", ["get", "pending"], 2.5, 1.2],
        "circle-stroke-color": [
          "case",
          ["get", "pending"], "#b5791a",
          ["case", ["get", "visited"], "#555555", "#222222"]
        ]
      }
    });
    wireEvents(map);
  }
  installed = true;
}

function wireEvents(map) {
  map.on("click", L_POINT, (e) => {
    const f = e.features && e.features[0];
    if (f) openGlPopup(normalizePointId(f.properties.id));
  });
  map.on("click", L_CLUSTER, (e) => {
    const f = e.features && e.features[0];
    const src = map.getSource(SRC);
    if (!f || !src || typeof src.getClusterExpansionZoom !== "function") return;
    src.getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: f.geometry.coordinates, zoom, duration: 400 });
    });
  });
  for (const layer of [L_POINT, L_CLUSTER]) {
    map.on("mouseenter", layer, () => { const c = map.getCanvas(); if (c) c.style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { const c = map.getCanvas(); if (c) c.style.cursor = ""; });
  }
}

function applyData(map) {
  const src = map.getSource(SRC);
  if (src && typeof src.setData === "function") src.setData(currentFc());
}

export function renderMarkersGl(points) {
  lastPoints = Array.isArray(points) ? points : [];
  const map = getMap();
  if (!map) return;
  const run = () => { ensureLayers(map); applyData(map); };
  // Les couches ne peuvent être ajoutées qu'une fois le style chargé.
  if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded() && typeof map.once === "function") {
    map.once("styledata", run);
  } else {
    run();
  }
}

export function upsertMarkerGl(point) {
  if (point && !lastPoints.some(p => normalizePointId(p.id) === normalizePointId(point.id))) {
    lastPoints = [...lastPoints, point];
  }
  const map = getMap();
  if (map && installed) applyData(map);
  else renderMarkersGl(lastPoints);
}

export function refreshMarkerGl() {
  const map = getMap();
  if (map && installed) applyData(map);
  if (currentPopup && currentPopupId) {
    const pt = (store.get("points") || []).find(p => normalizePointId(p.id) === currentPopupId);
    if (pt && typeof currentPopup.setDOMContent === "function") currentPopup.setDOMContent(buildPopup(pt));
  }
}

export function openGlPopup(pointId) {
  const map = getMap();
  const pid = normalizePointId(pointId);
  const point = (store.get("points") || []).find(p => normalizePointId(p.id) === pid);
  if (!map || !point) return;

  if (currentPopup) currentPopup.remove();
  const coords = toGeoJSONCoordinates(point.lat, point.lon);
  currentPopup = new maplibregl.Popup({
    offset: [0, -12],
    closeButton: true,
    closeOnClick: false,
    maxWidth: "min(92vw, 340px)"
  });
  if (coords) currentPopup.setLngLat(coords);
  currentPopup.setDOMContent(buildPopup(point));
  currentPopup.addTo(map);
  currentPopupId = pid;
  currentPopup.on("close", () => {
    if (currentPopupId === pid) { currentPopup = null; currentPopupId = null; }
  });
  store.set("ui.selectedPointId", pid);
  log.trace("MARKER_GL", `popup ouvert pour ${pid}`);
}

export function getFilteredBoundsGl() {
  return boundsFromFeatureCollection(currentFc());
}
