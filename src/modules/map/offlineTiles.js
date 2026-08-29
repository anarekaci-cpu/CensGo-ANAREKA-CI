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
 *
 * BUG CORRIGÉ : ce module ne préchargeait QUE la source claire (OpenFreeMap)
 * — le fond sombre (VersaTiles, voir map.js), utilisé par défaut depuis que
 * le thème sombre est devenu le réglage par défaut de l'app (core/theme.js),
 * n'était donc JAMAIS réellement pré-téléchargé : un agent qui préchargeait
 * une zone en pensant être couvert hors-ligne se retrouvait avec une carte
 * vide dès qu'il repassait (ou restait) en mode sombre sans réseau. Les deux
 * sources sont maintenant préchargées dans le même passage.
 */

import { shadow as versatilesShadow } from "@versatiles/style";

const CACHE_NAME = "map-tiles";

// L'URL de tuiles OpenFreeMap porte un SEGMENT DATÉ qui change à chaque
// rafraîchissement de leur extract planet (ex:
// "/planet/20260823_080002_pt/{z}/{x}/{y}.pbf") — l'écrire en dur finirait
// par pointer vers un instantané périmé. On résout donc TOUJOURS le
// style.json et son TileJSON en direct avant de télécharger quoi que ce
// soit, plutôt que de coder une URL figée — la même méthode sert aussi à
// découvrir les polices réellement utilisées (text-font de chaque layer),
// sans liste codée en dur qui se périmerait pareillement à un changement de
// style. "liberty" plutôt que "bright" : styles OpenFreeMap différents mais
// MÊME source vectorielle OpenMapTiles sous-jacente (seule la palette
// change) — peu importe lequel des deux est utilisé pour résoudre le
// gabarit de tuile, "bright" (voir map.js) fonctionne identiquement.
const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DARK_TILES_BASE_URL = "https://tiles.versatiles.org";
const GLYPH_RANGE = "0-255"; // latin de base + supplément : couvre les accents français (é, è, à, ç...)

/**
 * Normalise le champ "sprite" d'un style MapLibre : une simple chaîne
 * (OpenFreeMap) ou un tableau {id,url} (VersaTiles, plusieurs feuilles de
 * sprites nommées) — toujours renvoyé comme un tableau de bases d'URL.
 */
function normalizeSpriteBases(sprite) {
  if (!sprite) return [];
  return Array.isArray(sprite) ? sprite.map(s => s.url) : [sprite];
}

function extractFonts(layers) {
  const fonts = new Set();
  for (const layer of layers || []) {
    const tf = layer.layout?.["text-font"];
    if (tf) (Array.isArray(tf) ? tf : [tf]).forEach(f => fonts.add(f));
  }
  return [...fonts];
}

let lightResolvedPromise = null;

/**
 * Résout depuis le style.json OpenFreeMap EN DIRECT (jamais codé en dur,
 * voir commentaire plus haut) : le gabarit d'URL de tuile réel + son
 * maxzoom, les sprites et la liste des polices utilisées par les layers de
 * labels. Mémorisé pour la durée de la session (variable de module) : le
 * planet OpenFreeMap ne change qu'une fois par semaine, inutile de
 * re-résoudre à chaque clic sur "précharger" — un rechargement complet de
 * l'app (nouveau chargement de ce module) redemande naturellement un
 * instantané frais.
 */
async function resolveLightStyleUrls() {
  if (!lightResolvedPromise) {
    lightResolvedPromise = (async () => {
      const style = await fetch(LIGHT_STYLE_URL).then(r => r.json());
      const vectorSource = Object.values(style.sources).find(s => s.type === "vector");
      const tileJson = await fetch(vectorSource.url).then(r => r.json());

      return {
        label: "clair (OpenFreeMap)",
        styleUrl: LIGHT_STYLE_URL,
        tileTemplate: tileJson.tiles[0],
        maxzoom: tileJson.maxzoom ?? 14,
        spriteBases: normalizeSpriteBases(style.sprite),
        glyphsTemplate: style.glyphs,
        fonts: extractFonts(style.layers)
      };
    })();
  }
  return lightResolvedPromise;
}

let darkResolvedPromise = null;

/**
 * Résout le style sombre VersaTiles — généré EN MÉMOIRE via @versatiles/style
 * (même fonction que map.js), donc pas de fetch réseau pour le style
 * lui-même (rien à mettre en cache pour ça : reconstruit à l'identique même
 * hors-ligne). Contrairement à OpenFreeMap, le gabarit de tuile et le
 * maxzoom sont directement embarqués dans la source (pas d'indirection
 * TileJSON à résoudre séparément).
 */
async function resolveDarkStyleUrls() {
  if (!darkResolvedPromise) {
    darkResolvedPromise = (async () => {
      const style = versatilesShadow({ baseUrl: DARK_TILES_BASE_URL });
      const vectorSource = Object.values(style.sources).find(s => s.type === "vector");

      return {
        label: "sombre (VersaTiles)",
        styleUrl: null,
        tileTemplate: vectorSource.tiles[0],
        maxzoom: vectorSource.maxzoom ?? 14,
        spriteBases: normalizeSpriteBases(style.sprite),
        glyphsTemplate: style.glyphs,
        fonts: extractFonts(style.layers)
      };
    })();
  }
  return darkResolvedPromise;
}

function tileUrlFromTemplate(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function glyphUrl(glyphsTemplate, font, range) {
  return glyphsTemplate.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", range);
}

/**
 * Précharge le style (si son URL existe), les sprites (icônes) et les
 * glyphes (police des libellés) d'UN résolu — un petit nombre de requêtes
 * fixes, à part des milliers de tuiles. Best-effort : une police ou une
 * variante sprite manquante ne bloque jamais le reste (le fond de carte
 * reste utilisable, juste avec un détail visuel en moins).
 */
async function cacheStaticStyleAssets(cache, resolved) {
  const urls = [
    ...(resolved.styleUrl ? [resolved.styleUrl] : []),
    ...resolved.spriteBases.flatMap(base => [`${base}.json`, `${base}.png`, `${base}@2x.json`, `${base}@2x.png`]),
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
 * Télécharge et met en cache les tuiles couvrant `bounds`, pour les DEUX
 * fonds de carte (clair OpenFreeMap + sombre VersaTiles) — un agent qui
 * précharge une zone reste couvert hors-ligne quel que soit le thème choisi
 * ensuite, ou celui déjà actif au moment du basculement (voir le bug
 * corrigé en tête de fichier). Une source dont la résolution échoue (ex:
 * OpenFreeMap injoignable) n'empêche pas l'autre d'être préchargée — le
 * résultat rapporte alors une couverture partielle plutôt que rien du tout.
 *
 * @param {{west:number, south:number, east:number, north:number}} bounds
 * @param {object} [options]
 * @param {number[]} [options.zooms] niveaux de zoom à précharger
 * @param {number} [options.maxTiles] garde-fou anti-abus (zone trop grande), TOTAL des deux sources
 * @param {(done:number, total:number) => void} [options.onProgress]
 * @returns {Promise<{total:number, downloaded:number, failed:number, skippedAlreadyCached:number, sourcesFailed:string[]}>}
 */
export async function downloadOfflineTiles(bounds, {
  zooms = [12, 13, 14],
  maxTiles = 1500,
  onProgress
} = {}) {
  if (!("caches" in window)) {
    throw new Error("Le stockage hors-ligne (Cache API) n'est pas disponible sur ce navigateur.");
  }

  const SOURCE_LABELS = ["clair", "sombre"];
  const settled = await Promise.allSettled([resolveLightStyleUrls(), resolveDarkStyleUrls()]);
  const resolvedList = settled.filter(r => r.status === "fulfilled").map(r => r.value);
  // Index conservé AVANT le filter (sinon "i" ré-indexerait dans le tableau
  // filtré et associerait le mauvais libellé à l'échec).
  const sourcesFailed = settled
    .map((r, i) => (r.status === "rejected" ? SOURCE_LABELS[i] : null))
    .filter(Boolean);
  if (resolvedList.length === 0) {
    throw new Error("Impossible de récupérer les informations du fond de carte (réseau indisponible).");
  }

  // Au-delà du maxzoom réel du tuiler, aucune tuile distincte n'existe côté
  // serveur (MapLibre sur-échantillonne la plus profonde déjà en cache) — un
  // appelant qui demande un zoom plus élevé ne gaspille donc pas de requêtes
  // sur des tuiles vectorielles inexistantes. Chaque source a son propre
  // maxzoom (les deux tuileurs peuvent diverger).
  const tasks = resolvedList.flatMap(resolved => {
    const clampedZooms = [...new Set(zooms.map(z => Math.min(z, resolved.maxzoom)))];
    return computeTileList(bounds, clampedZooms).map(t => ({ ...t, resolved }));
  });

  if (tasks.length === 0) {
    throw new Error("Aucune tuile à précharger pour cette zone.");
  }
  if (tasks.length > maxTiles) {
    throw new Error(
      `Zone trop grande pour un préchargement (${tasks.length} tuiles pour les deux fonds de carte, max ${maxTiles}). ` +
      "Zoomez sur une zone plus précise avant de relancer."
    );
  }

  const cache = await caches.open(CACHE_NAME);
  await Promise.all(resolvedList.map(resolved => cacheStaticStyleAssets(cache, resolved)));

  const queue = [...tasks];
  let done = 0;
  let downloaded = 0;
  let failed = 0;
  let skippedAlreadyCached = 0;

  const CONCURRENCY = 6;
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      const url = tileUrlFromTemplate(t.resolved.tileTemplate, t.z, t.x, t.y);

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
      onProgress?.(done, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));

  return { total: tasks.length, downloaded, failed, skippedAlreadyCached, sourcesFailed };
}
