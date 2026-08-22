import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/Recensement-ANAREKA-CI/",
  server: {
    host: "0.0.0.0",
    port: 3000
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Recensement ANAREKA-CI",
        short_name: "ANAREKA-CI",
        description: "Application de recensement terrain pour agents ANAREKA-CI en Côte d'Ivoire",
        start_url: "/Recensement-ANAREKA-CI/",
        display: "standalone",
        background_color: "#1a3d2b",
        theme_color: "#1a3d2b",
        orientation: "portrait-primary",
        icons: [
          { src: "/Recensement-ANAREKA-CI/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "/Recensement-ANAREKA-CI/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
          { src: "/Recensement-ANAREKA-CI/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" }
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
            // Tuiles du fond de carte : CARTO (principal) + OSM (transition).
            // Nouveau cache "map-tiles" : départ propre, l'ancien cache
            // "osm-tiles" peut contenir des entrées de la période cassée.
            urlPattern: /^https:\/\/([abcd]\.)?basemaps\.cartocdn\.com\/.*/,
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
            urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "osrm-routes",
              expiration: { maxEntries: 500, maxAgeSeconds: 86400 }
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
    rollupOptions: {
      output: {
        manualChunks: {
          maplibregl: ["maplibre-gl", "supercluster"],
          supabase: ["@supabase/supabase-js"],
          dexie: ["dexie"]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
