/**
 * Aides PURES pour le chargement spatial par emprise (BBOX) — voir
 * supabase/add_spatial_bbox.sql et modules/census/dataLoader.js.
 * Aucune I/O ici : uniquement la préparation des arguments du RPC et la
 * décision "l'emprise a-t-elle assez bougé pour re-interroger le serveur ?".
 */

/**
 * Traduit une emprise de carte { west, south, east, north } en arguments du
 * RPC census_points_in_bbox. Renvoie null si l'emprise est invalide.
 *
 * @param {{west:number, south:number, east:number, north:number}} bounds
 * @param {{maxRows?:number}} [opts]
 */
export function bboxRpcArgs(bounds, { maxRows = 2000 } = {}) {
  if (!bounds) return null;
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const n = Number(maxRows);
  return {
    min_lon: Math.min(west, east),
    min_lat: Math.min(south, north),
    max_lon: Math.max(west, east),
    max_lat: Math.max(south, north),
    max_rows: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 2000
  };
}

/**
 * Anti-spam du RPC : un pan de quelques pixels ou un léger zoom ne doit pas
 * relancer une requête réseau. On re-interroge si le centre s'est déplacé
 * d'au moins `minMoveFrac` de la diagonale visible, OU si la surface visible
 * a changé d'au moins `minSpanFrac` (dézoom => nouvelle zone à couvrir).
 *
 * @param {object|null} prev - emprise du dernier fetch (ou null : jamais fait)
 * @param {object|null} next - emprise courante
 * @param {{minMoveFrac?:number, minSpanFrac?:number}} [opts]
 * @returns {boolean}
 */
export function boundsChangedEnough(prev, next, { minMoveFrac = 0.35, minSpanFrac = 0.4 } = {}) {
  if (!next || ![next.west, next.south, next.east, next.north].every(Number.isFinite)) return false;
  if (!prev) return true;

  const spanX = (b) => Math.abs(b.east - b.west);
  const spanY = (b) => Math.abs(b.north - b.south);
  const centerX = (b) => (b.east + b.west) / 2;
  const centerY = (b) => (b.north + b.south) / 2;

  const nDiag = Math.hypot(spanX(next), spanY(next)) || 1e-9;
  const moved = Math.hypot(centerX(next) - centerX(prev), centerY(next) - centerY(prev));
  if (moved / nDiag >= minMoveFrac) return true;

  const prevArea = (spanX(prev) * spanY(prev)) || 1e-9;
  const areaChange = Math.abs(spanX(next) * spanY(next) - prevArea) / prevArea;
  return areaChange >= minSpanFrac;
}
