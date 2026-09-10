/**
 * Aides PURES pour le rendu WebGL natif des marqueurs (couches MapLibre
 * `circle` + clustering natif) — voir modules/census/markersGl.js.
 *
 * Séparé du renderer pour être testable sans carte : construction de la
 * FeatureCollection, expression de couleur data-driven par statut, calcul
 * d'emprise à partir des features.
 */

import { toGeoJSONCoordinates } from "./geo.js";
import { CONFIG } from "./config.js";

/**
 * Transforme la liste de points (déjà filtrée par l'appelant) en
 * FeatureCollection GeoJSON. Chaque feature ne porte que les propriétés
 * utiles au style : id (string), status, visited (bool), pending (bool).
 * Les points sans coordonnées fiables sont ignorés (jamais de [0,0] ni de
 * paire inversée — même garantie que le renderer DOM, via toGeoJSONCoordinates).
 *
 * @param {object[]} points
 * @param {{pendingIds?: Set<string>|string[]}} [opts]
 * @returns {{type:"FeatureCollection", features:object[]}}
 */
export function pointsToFeatureCollection(points, { pendingIds } = {}) {
  const pend = pendingIds instanceof Set ? pendingIds : new Set(pendingIds || []);
  const features = [];
  for (const p of Array.isArray(points) ? points : []) {
    const coords = toGeoJSONCoordinates(p?.lat, p?.lon);
    if (coords === null) continue;
    const id = p.id == null ? "" : String(p.id);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {
        id,
        status: p.status || "NON DEFINI",
        visited: p.visited === true,
        pending: pend.has(id)
      }
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Expression MapLibre `match` : couleur du point selon `status`, repli gris
 * (#95a5a6) pour tout statut inconnu. Reprend CONFIG.STATUS_COLORS pour
 * rester aligné avec la légende et le renderer DOM (buildIconHTML).
 */
export function statusColorExpression() {
  const expr = ["match", ["get", "status"]];
  for (const [status, color] of Object.entries(CONFIG.STATUS_COLORS || {})) {
    expr.push(status, color);
  }
  expr.push("#95a5a6");
  return expr;
}

/**
 * Emprise [[west,south],[east,north]] couvrant toutes les features, ou null
 * si la collection est vide. Sert de remplacement WebGL à
 * markers.getFilteredBounds() (bouton "Vue d'ensemble filtrés").
 */
export function boundsFromFeatureCollection(fc) {
  const feats = fc?.features || [];
  if (feats.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of feats) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c)) continue;
    const [lon, lat] = c;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  if (w === Infinity) return null;
  return [[w, s], [e, n]];
}
