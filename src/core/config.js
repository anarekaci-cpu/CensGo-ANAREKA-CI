/**
 * Configuration centralisée de l'application
 * Toutes les valeurs sensibles sont injectées via variables d'environnement Vite
 * ⚠️ Ne jamais hardcoder de clés API ici
 */

export const CONFIG = {
  // Supabase
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',

  // OSRM Routing
  OSRM_URL: import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org',

  // Application
  APP_NAME: import.meta.env.VITE_APP_NAME || 'Recensement ANAREKA',
  APP_VERSION: import.meta.env.VITE_APP_VERSION || '2.0.0',
  APP_ENV: import.meta.env.VITE_APP_ENV || 'production',

  // Features
  ENABLE_OFFLINE: import.meta.env.VITE_ENABLE_OFFLINE !== 'false',
  ENABLE_TOUR_OPTIMIZATION: import.meta.env.VITE_ENABLE_TOUR_OPTIMIZATION !== 'false',

  // Cartographie
  MAP_DEFAULT_CENTER: [5.3599, -4.0083], // Bingerville, Côte d'Ivoire
  MAP_DEFAULT_ZOOM: 14,
  MAP_MAX_ZOOM: 19,

  // Stockage offline
  DB_NAME: 'anareka-recensement-db',
  DB_VERSION: 1,

  // Sync
  SYNC_INTERVAL_MS: 30000, // 30 secondes
  MAX_RETRY_ATTEMPTS: 3,
};

// Validation au démarrage
function validateConfig() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !CONFIG[key] || CONFIG[key].trim() === '');

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
