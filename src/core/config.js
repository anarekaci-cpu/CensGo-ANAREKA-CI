/**
 * Configuration centralisée de l'application
 * Toutes les valeurs sensibles sont injectées via variables d'environnement Vite
 * ⚠️ Ne jamais hardcoder de clés API ici
 */

export const CONFIG = {
  // Supabase
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  // Table Supabase contenant les points de recensement
  TABLE_NAME: import.meta.env.VITE_SUPABASE_TABLE || 'census_points',

  // OSRM Routing
  OSRM_URL: import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org',

  // Application
  APP_NAME: import.meta.env.VITE_APP_NAME || 'CensGo',
  APP_VERSION: import.meta.env.VITE_APP_VERSION || '2.0.0',
  APP_ENV: import.meta.env.VITE_APP_ENV || 'production',

  // Features
  ENABLE_OFFLINE: import.meta.env.VITE_ENABLE_OFFLINE !== 'false',
  ENABLE_TOUR_OPTIMIZATION: import.meta.env.VITE_ENABLE_TOUR_OPTIMIZATION !== 'false',

  // Cartographie
  // NOTE: ces clés étaient absentes de CONFIG (MAP_CENTER/MAP_ZOOM) alors qu'elles
  // sont utilisées par src/modules/map/map.js -> la carte ne s'initialisait jamais.
  MAP_CENTER: [
    Number(import.meta.env.VITE_MAP_CENTER_LAT) || 5.3724499,
    Number(import.meta.env.VITE_MAP_CENTER_LNG) || -3.9676843
  ], // Cocody, Abidjan — siège de l'ANAREKA-CI. Le recensement couvre toute la
     // Côte d'Ivoire ; ce n'est qu'un point de départ, pas une limite de zone.
  MAP_ZOOM: Number(import.meta.env.VITE_MAP_ZOOM) || 12,
  MAP_MAX_ZOOM: 19,

  // Rayon (en mètres) considéré comme "arrivé" pendant la navigation
  ARRIVAL_RADIUS_M: Number(import.meta.env.VITE_ARRIVAL_RADIUS_M) || 30,

  // Couleurs par statut (utilisées par les marqueurs, popups, légende)
  STATUS_COLORS: {
    'VERT (Joignable)': '#2ecc71',
    'JAUNE (Injoignable)': '#f1c40f',
    'ROUGE (Refus)': '#e74c3c',
    'VIOLET (A verifier)': '#9b59b6',
    'NON DEFINI': '#95a5a6'
  },

  // Variantes assombries pour le TEXTE des badges de statut. Les couleurs
  // vives ci-dessus (surtout le jaune #f1c40f) ont un contraste défaillant
  // (< 3:1) sur fond clair quand elles servent de police — illisible en
  // plein soleil pour l'info critique "statut". Ces teintes gardent la
  // sémantique de la couleur mais passent les seuils WCAG AA.
  STATUS_TEXT_COLORS: {
    'VERT (Joignable)': '#1b7a43',
    'JAUNE (Injoignable)': '#8a6400',
    'ROUGE (Refus)': '#b03a2e',
    'VIOLET (A verifier)': '#6c3483',
    'NON DEFINI': '#566573'
  },

  // Stockage offline
  DB_NAME: 'anareka-recensement-db',
  DB_VERSION: 1,

  // Sync
  SYNC_INTERVAL_MS: 30000, // 30 secondes
  MAX_RETRY_ATTEMPTS: 3,
};

// Validation au démarrage
function validateConfig() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TABLE_NAME'];
  const missing = required.filter(key => !CONFIG[key] || String(CONFIG[key]).trim() === '');

  if (missing.length > 0) {
    console.error('[CONFIG] Variables manquantes :', missing.join(', '));
    console.error('[CONFIG] Assurez-vous que le fichier .env est correctement configuré.');
    // En dev, on affiche une alerte ; en prod, on log silencieusement
    if (CONFIG.APP_ENV === 'development') {
      alert('Configuration incomplète : vérifiez votre fichier .env\nVariables manquantes : ' + missing.join(', '));
    }
  }
}

validateConfig();

export default CONFIG;
