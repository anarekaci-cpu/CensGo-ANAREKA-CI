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

// BUG CORRIGÉ (round 2) : ce module ciblait le CDN vecteur CARTO, abandonné
// au profit d'OpenFreeMap (voir map.js — bien plus de détail piéton :
// passages, sentiers, carrefours, choix assumé avec l'utilisateur malgré un
// fournisseur moins établi que CARTO). OpenFreeMap complique le
// préchargement PROACTIF d'un détail important : son URL de tuiles porte un
// SEGMENT DATÉ qui change à chaque rafraîchissement de leur extract planet
// (ex: "/planet/20260823_080002_pt/{z}/{x}/{y}.pbf") — l'écrire en dur ici
// finirait par pointer vers un instantané périmé. On résout donc TOUJOURS le
// style.json et son TileJSON en direct avant de télécharger quoi que ce
// soit, plutôt que de coder une URL figée — la même méthode sert aussi à
// découvrir les polices réellement utilisées (text-font de chaque layer),
// sans liste codée en dur qui se périmerait pareillement à un changement de
// style.
// Volontairement toujours le style CLAIR, même si l'agent est en thème
// sombre : les styles OpenFreeMap clair/sombre partagent la MÊME source
// vectorielle OpenMapTiles (seule la palette change), donc précharger via
// "liberty" couvre aussi le rendu du fond de carte OpenFreeMap. Le fond
// sombre "shadow" (VersaTiles, voir map.js) vient d'une source différente
// (tiles.versatiles.org) : il n'est PAS couvert par ce préchargement proactif
// — seulement mis en cache passivement par le Service Worker au fil de ce que
// l'agent fait défiler en ligne (voir vite.config.js). Limite assumée : ce
// module cible la zone de terrain à couvrir, pas un fournisseur de tuiles en
// particulier.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const GLYPH_RANGE = "0-255"; // latin de base + supplément : couvre les accents français (é, è, à, ç...)

let resolvedUrlsPromise = null;

/**
 * Résout depuis le style.json EN DIRECT (jamais codé en dur, voir
 * commentaire plus haut) : le gabarit d'URL de tuile réel + son maxzoom, le
 * sprite et la liste des polices utilisées par les layers de labels.
 * Mémorisé pour la durée de la session (variable de module) : le planet
 * OpenFreeMap ne change qu'une fois par semaine, inutile de re-résoudre à
 * chaque clic sur "précharger" — un rechargement complet de l'app (nouveau
 * chargement de ce module) redemande naturellement un instantané frais.
 */
async function resolveStyleUrls() {
  if (!resolvedUrlsPromise) {
    resolvedUrlsPromise = (async () => {
      const style = await fetch(STYLE_URL).then(r => r.json());
      const vectorSource = Object.values(style.sources).find(s => s.type === "vector");
      const tileJson = await fetch(vectorSource.url).then(r => r.json());

      const fonts = new Set();
      for (const layer of style.layers) {
        const tf = layer.layout?.["text-font"];
        if (tf) (Array.isArray(tf) ? tf : [tf]).forEach(f => fonts.add(f));
      }

      return {
        tileTemplate: tileJson.tiles[0],
        maxzoom: tileJson.maxzoom ?? 14,
        spriteBase: style.sprite,
        glyphsTemplate: style.glyphs,
        fonts: [...fonts]
      };
    })();
  }
  return resolvedUrlsPromise;
}

function tileUrlFromTemplate(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function glyphUrl(glyphsTemplate, font, range) {
  return glyphsTemplate.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", range);
}

/**
 * Précharge le style, le sprite (icônes) et les glyphes (police des
 * libellés) — un petit nombre de requêtes fixes, à part des milliers de
 * tuiles. Best-effort : une police ou une variante sprite manquante ne
 * bloque jamais le reste (le fond de carte reste utilisable, juste avec un
 * détail visuel en moins).
 */
async function cacheStaticStyleAssets(cache, resolved) {
  const urls = [
    STYLE_URL,
    `${resolved.spriteBase}.json`, `${resolved.spriteBase}.png`,
    `${resolved.spriteBase}@2x.json`, `${resolved.spriteBase}@2x.png`,
    ...resolved.fonts.map(f => glyphUrl(resolved.glyphsTemplate, f, GLYPH_RANGE))
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

  let resolved;
  try {
    resolved = await resolveStyleUrls();
  } catch (err) {
    throw new Error(`Impossible de récupérer les informations du fond de carte (${err?.message || "réseau indisponible"}).`);
  }

  // Au-delà du maxzoom réel du tuiler, aucune tuile distincte n'existe côté
  // serveur (MapLibre sur-échantillonne la plus profonde déjà en cache) — un
  // appelant qui demande un zoom plus élevé ne gaspille donc pas de requêtes
  // sur des tuiles vectorielles inexistantes.
  const clampedZooms = [...new Set(zooms.map(z => Math.min(z, resolved.maxzoom)))];

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
  await cacheStaticStyleAssets(cache, resolved);
  const queue = [...tiles];
  let done = 0;
  let downloaded = 0;
  let failed = 0;
  let skippedAlreadyCached = 0;

  const CONCURRENCY = 6;
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      const url = tileUrlFromTemplate(resolved.tileTemplate, t.z, t.x, t.y);

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
