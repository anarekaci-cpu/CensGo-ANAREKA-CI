import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/Recensement-ANAREKA-CI/",
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
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
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
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["leaflet", "leaflet.markercluster", "@supabase/supabase-js", "dexie"]
        }
      }
    }
  }
});
