// === Configuration centralisée (via import.meta.env) ===
export const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || "",
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  TABLE_NAME: "census_points",

  MAP_CENTER: [
    parseFloat(import.meta.env.VITE_MAP_CENTER_LAT) || 5.355,
    parseFloat(import.meta.env.VITE_MAP_CENTER_LNG) || -3.88
  ],
  MAP_ZOOM: parseInt(import.meta.env.VITE_MAP_ZOOM) || 13,

  OSRM_URL: import.meta.env.VITE_OSRM_URL || "https://router.project-osrm.org",

  STATUS_COLORS: {
    "VERT (Joignable)": "#2ecc71",
    "JAUNE (Injoignable)": "#f1c40f",
    "ROUGE (Refus)": "#e74c3c",
    "VIOLET (A verifier)": "#9b59b6",
    "NON DEFINI": "#95a5a6"
  },

  ARRIVAL_RADIUS_M: 25,
  SYNC_INTERVAL_MS: 30000, // 30s
  MAX_RETRY_ATTEMPTS: 5
};

// Validation au boot
if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
  console.warn("⚠️ Variables Supabase non définies. Mode démo/local uniquement.");
}
