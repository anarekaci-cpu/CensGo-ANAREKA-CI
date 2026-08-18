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
        start_url: "/Recensement-ANAREKA-CI/",
        display: "standalone",
        background_color: "#1a3d2b",
        theme_color: "#1a3d2b",
        orientation: "portrait-primary",
        icons: [
          { src: "/Recensement-ANAREKA-CI/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
          { src: "/Recensement-ANAREKA-CI/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 86400 * 30 }
            }
          },
          {
            urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "osrm-routes",
              expiration: { maxEntries: 200, maxAgeSeconds: 3600 }
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
  }
});
