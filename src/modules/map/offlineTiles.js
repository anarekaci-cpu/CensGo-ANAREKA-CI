/**
 * Préchargement proactif des tuiles de fond de carte pour une utilisation
 * hors-ligne garantie.
 *
 * Le cache Workbox "map-tiles" (vite.config.js, handler CacheFirst) ne
 * contient QUE les tuiles que l'agent a réellement fait défiler à l'écran —
 * une zone jamais visitée en ligne reste donc invisible une fois hors
 * connexion. Ce module télécharge et insère directement dans CE MÊME cache
 * (même nom "map-tiles") les tuiles d'une zone donnée sur plusieurs niveaux
 * de zoom, AVANT que l'agent ne perde la connexion — le handler CacheFirst
 * de Workbox les sert ensuite normalement, sans aucune différence avec une
 * tuile mise en cache "naturellement" en naviguant.
 */

const CACHE_NAME = "map-tiles";
const TILE_SUBDOMAINS = ["a", "b", "c", "d"];

// BUG CORRIGÉ : ce module ciblait encore l'ancien CDN de tuiles RASTER
// ({a,b,c}.basemaps.cartocdn.com/rastertiles/...), fermé par CARTO (voir
// map.js — bascule vers le style GL vecteur "voyager-gl-style"). Le préchargement
// hors-ligne échouait donc silencieusement sur CHAQUE tuile (404/erreur
// réseau, comptées en `failed` sans jamais rien mettre en cache). URL du
// tuiler vecteur récupérée depuis le TileJSON réel de la source "carto" du
// style (tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json),
// vérifiée manuellement avant ce correctif — maxzoom réel = 14 (au-delà,
// MapLibre sur-échantillonne la tuile z14 côté client, sans nouvelle requête
// réseau : inutile de précharger plus profond).
function tileUrl(subdomain, z, x, y) {
  return `https://tiles-${subdomain}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/${z}/${x}/${y}.mvt`;
}

const VECTOR_SOURCE_MAXZOOM = 14;

// Polices utilisées par le style "voyager-gl-style" (voir style.json,
// propriété "text-font" de chaque layer de labels) — préchargées pour la
// plage de glyphes 0-255 (latin de base + supplément, couvre les accents
// français : é, è, à, ç...) afin que les libellés (noms de rue/quartier)
// restent lisibles hors-ligne, pas seulement le fond de carte brut.
const LABEL_FONTS = [
  "Open Sans Regular", "Open Sans Bold", "Open Sans Italic",
  "Montserrat Regular", "Montserrat Medium", "Montserrat Regular Italic", "Montserrat Medium Italic",
  "Noto Sans Regular", "HanWangHeiLight Regular", "NanumBarunGothic Regular"
];

const STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const SPRITE_BASE = "https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/sprite";
const GLYPH_RANGE = "0-255";

function glyphUrl(font) {
  return `https://tiles.basemaps.cartocdn.com/fonts/${encodeURIComponent(font)}/${GLYPH_RANGE}.pbf`;
}

/**
 * Précharge le style, le sprite (icônes) et les glyphes (police des
 * libellés) — un petit nombre de requêtes fixes, à part des milliers de
 * tuiles. Best-effort : une police ou une variante sprite manquante ne
 * bloque jamais le reste (le fond de carte reste utilisable, juste avec un
 * détail visuel en moins).
 */
async function cacheStaticStyleAssets(cache) {
  const urls = [
    STYLE_URL,
    `${SPRITE_BASE}.json`, `${SPRITE_BASE}.png`,
    `${SPRITE_BASE}@2x.json`, `${SPRITE_BASE}@2x.png`,
    ...LABEL_FONTS.map(glyphUrl)
  ];
  await Promise.all(urls.map(async (url) => {
    try {
      if (await cache.match(url)) return;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res.clone());
    } catch {
      // Best-effort — voir commentaire de la fonction.
    }
  }));
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom
  );
}

/**
 * Calcule la liste (dédupliquée) des tuiles {z,x,y} couvrant `bounds` pour
 * chaque niveau de zoom de `zooms`.
 *
 * @param {{west:number, south:number, east:number, north:number}} bounds
 * @param {number[]} zooms
 * @returns {{z:number, x:number, y:number}[]}
 */
export function computeTileList(bounds, zooms) {
  const tiles = [];
  if (!bounds || !Array.isArray(zooms)) return tiles;

  for (const z of zooms) {
    const clampedZ = Math.max(0, Math.min(22, Math.floor(z)));
    const maxTileIndex = 2 ** clampedZ - 1;

    const xMin = Math.max(0, lonToTileX(bounds.west, clampedZ));
    const xMax = Math.min(maxTileIndex, lonToTileX(bounds.east, clampedZ));
    // La coordonnée Y des tuiles slippy-map croît vers le SUD : le nord de
    // la zone donne le Y minimal.
    const yMin = Math.max(0, latToTileY(bounds.north, clampedZ));
    const yMax = Math.min(maxTileIndex, latToTileY(bounds.south, clampedZ));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z: clampedZ, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Télécharge et met en cache les tuiles couvrant `bounds`.
 *
 * @param {{west:number, south:number, east:number, north:number}} bounds
 * @param {object} [options]
 * @param {number[]} [options.zooms] niveaux de zoom à précharger
 * @param {number} [options.maxTiles] garde-fou anti-abus (zone trop grande)
 * @param {(done:number, total:number) => void} [options.onProgress]
 * @returns {Promise<{total:number, downloaded:number, failed:number, skippedAlreadyCached:number}>}
 */
export async function downloadOfflineTiles(bounds, {
  zooms = [12, 13, 14],
  maxTiles = 1500,
  onProgress
} = {}) {
  if (!("caches" in window)) {
    throw new Error("Le stockage hors-ligne (Cache API) n'est pas disponible sur ce navigateur.");
  }

  // Au-delà de VECTOR_SOURCE_MAXZOOM, aucune tuile distincte n'existe côté
  // serveur (MapLibre sur-échantillonne la tuile z14 déjà en cache) — un
  // appelant qui demande [13,14,15,16,17] (ancien défaut raster) ne
  // gaspille donc plus de requêtes sur des tuiles vectorielles inexistantes.
  const clampedZooms = [...new Set(zooms.map(z => Math.min(z, VECTOR_SOURCE_MAXZOOM)))];

  const tiles = computeTileList(bounds, clampedZooms);
  if (tiles.length === 0) {
    throw new Error("Aucune tuile à précharger pour cette zone.");
  }
  if (tiles.length > maxTiles) {
    throw new Error(
      `Zone trop grande pour un préchargement (${tiles.length} tuiles, max ${maxTiles}). ` +
      "Zoomez sur une zone plus précise avant de relancer."
    );
  }

  const cache = await caches.open(CACHE_NAME);
  await cacheStaticStyleAssets(cache);
  const queue = [...tiles];
  let done = 0;
  let downloaded = 0;
  let failed = 0;
  let skippedAlreadyCached = 0;

  const CONCURRENCY = 6;
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      // Sous-domaine déterministe (répartit la charge comme MapLibre, sans
      // dépendre d'un état partagé entre workers).
      const subdomain = TILE_SUBDOMAINS[(t.x + t.y) % TILE_SUBDOMAINS.length];
      const url = tileUrl(subdomain, t.z, t.x, t.y);

      try {
        const alreadyCached = await cache.match(url);
        if (alreadyCached) {
          skippedAlreadyCached++;
        } else {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res.clone());
            downloaded++;
          } else {
            failed++;
          }
        }
      } catch {
        // Tuile individuelle en échec (réseau, timeout) : on continue sans
        // faire échouer tout le téléchargement pour une seule tuile.
        failed++;
      }

      done++;
      onProgress?.(done, tiles.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker));

  return { total: tiles.length, downloaded, failed, skippedAlreadyCached };
}
