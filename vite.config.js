import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/CensGo-ANAREKA-CI/",
  server: {
    host: "0.0.0.0",
    port: 3000
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "CensGo — Recensement ANAREKA-CI",
        short_name: "CensGo",
        description: "Application de recensement terrain pour agents ANAREKA-CI en Côte d'Ivoire",
        start_url: "/CensGo-ANAREKA-CI/",
        display: "standalone",
        background_color: "#1a3d2b",
        theme_color: "#1a3d2b",
        orientation: "portrait-primary",
        // PNG en premier (et pas seulement SVG) : indispensable pour
        // l'installabilité Android (WebAPK) et les générateurs d'APK type
        // PWABuilder/Bubblewrap, qui exigent des icônes PNG 192/512 — le SVG
        // seul y est mal ou pas supporté. SVG conservé en repli.
        icons: [
          { src: "/CensGo-ANAREKA-CI/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/CensGo-ANAREKA-CI/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/CensGo-ANAREKA-CI/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/CensGo-ANAREKA-CI/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "/CensGo-ANAREKA-CI/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Sans ça, les fichiers précachés d'un ancien build (chunks avec un
        // hash désormais obsolète) restent indéfiniment dans le Cache
        // Storage du téléphone à chaque nouveau déploiement — sur une PWA
        // terrain utilisée pendant des mois, ça finit par accumuler des
        // dizaines de versions inutiles. Complémentaire au filet lazyImport
        // (core/lazyImport.js) qui gère, lui, l'onglet resté ouvert au
        // moment précis du déploiement.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Fond de carte OpenFreeMap : style, tuiles vecteur (planet),
            // sprite et glyphes vivent tous sous tiles.openfreemap.org (voir
            // map.js — bascule depuis CARTO pour plus de détail piéton,
            // choix assumé avec l'utilisateur). Un seul host à couvrir,
            // contrairement à CARTO qui étalait ça sur plusieurs sous-domaines.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 86400 * 30 },
              // Ne cacher QUE les réponses valides : sans ça, une réponse
              // d'erreur du serveur de tuiles pouvait être persistée et
              // resservie depuis le cache pendant toute sa durée de vie.
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Fond de carte sombre VersaTiles (voir map.js) : même cache
            // "map-tiles" qu'OpenFreeMap — passif seulement (mis en cache au
            // fil de ce que l'agent fait défiler en mode sombre), pas de
            // préchargement proactif équivalent à offlineTiles.js pour ce
            // fournisseur (limité au style clair OpenFreeMap, seul utilisé
            // par le bouton "précharger une zone").
            urlPattern: /^https:\/\/tiles\.versatiles\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 86400 * 30 },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "osrm-routes",
              expiration: { maxEntries: 500, maxAgeSeconds: 86400 }
            }
          },
          {
            // OpenRouteService (Priorité 1 roadmap) : requête GET, coordonnées
            // dans l'URL (voir calculateRouteViaORS, routing.js) — même
            // stratégie de cache que "osrm-routes" ci-dessus, sûre car la clé
            // de cache (l'URL) identifie le trajet de façon unique.
            urlPattern: /^https:\/\/api\.openrouteservice\.org\/v2\/directions\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "ors-routes",
              expiration: { maxEntries: 500, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 86400 * 365 }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
    // maplibre-gl (~800 Ko minifié) n'a pas de build allégé côté npm sans
    // perdre le clustering/heatmap déjà utilisés (modules/map/map.js,
    // modules/census/markers.js) — aucune réduction de poids possible sans
    // réécrire ces fonctionnalités. Le chunk dédié ci-dessous n'est chargé
    // qu'après authentification (import() différé dans appShell.js), donc
    // hors du chemin critique (écran de connexion : ~44 Ko gzip pour
    // index.js). Seuil relevé pour ne plus avertir sur CE chunk isolé et
    // déjà paresseux — pas pour masquer une vraie régression ailleurs.
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl") || id.includes("supercluster")) return "maplibregl";
          if (id.includes("@supabase/supabase-js")) return "supabase";
          if (id.includes("/dexie/") || id.includes("\\dexie\\")) return "dexie";
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
