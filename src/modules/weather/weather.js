/**
 * Météo terrain — Open-Meteo (100% gratuit, sans clé API).
 *
 * Deux usages concrets pour un agent de recensement :
 * - météo actuelle à sa position (widget appShell) ;
 * - alerte pluie avant de démarrer une tournée (pistes non bitumées à
 *   Bingerville notamment — un départ sous pluie annoncée a un vrai coût
 *   terrain, contrairement à une simple gêne en ville).
 *
 * Mise en cache dans la table Dexie "meta" (getMeta/setMeta, voir
 * db/database.js) plutôt qu'une nouvelle table : un objet unique par
 * position arrondie, pas une collection à interroger.
 */

import { getMeta, setMeta } from "../../db/database.js";
import { log } from "../../core/debug.js";

const API_URL = "https://api.open-meteo.com/v1/forecast";

// Fraîcheur maximale d'une réponse avant nouvel appel réseau — la météo ne
// change pas assez vite pour justifier un appel à chaque ouverture d'écran,
// et ça évite de solliciter Open-Meteo à chaque re-render du widget.
const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Grille d'arrondi des coordonnées pour la clé de cache (~1,1 km à cette
// latitude) : deux positions GPS de l'agent à quelques centaines de mètres
// d'écart pendant la même tournée retombent sur la même entrée de cache au
// lieu de déclencher un appel réseau par léger déplacement.
const CACHE_COORD_PRECISION = 2;

/**
 * Codes météo WMO (norme utilisée par Open-Meteo) -> icône + libellé FR.
 * Liste volontairement complète (y compris neige, jamais observée en Côte
 * d'Ivoire) : un code inconnu ne doit jamais planter l'affichage.
 */
const WEATHER_CODES = {
  0: { icon: "☀️", label: "Ciel dégagé" },
  1: { icon: "🌤️", label: "Plutôt dégagé" },
  2: { icon: "⛅", label: "Partiellement nuageux" },
  3: { icon: "☁️", label: "Couvert" },
  45: { icon: "🌫️", label: "Brouillard" },
  48: { icon: "🌫️", label: "Brouillard givrant" },
  51: { icon: "🌦️", label: "Bruine légère" },
  53: { icon: "🌦️", label: "Bruine modérée" },
  55: { icon: "🌧️", label: "Bruine forte" },
  56: { icon: "🌧️", label: "Bruine verglaçante légère" },
  57: { icon: "🌧️", label: "Bruine verglaçante forte" },
  61: { icon: "🌧️", label: "Pluie légère" },
  63: { icon: "🌧️", label: "Pluie modérée" },
  65: { icon: "🌧️", label: "Pluie forte" },
  66: { icon: "🌧️", label: "Pluie verglaçante légère" },
  67: { icon: "🌧️", label: "Pluie verglaçante forte" },
  71: { icon: "❄️", label: "Neige légère" },
  73: { icon: "❄️", label: "Neige modérée" },
  75: { icon: "❄️", label: "Neige forte" },
  77: { icon: "❄️", label: "Grains de neige" },
  80: { icon: "🌦️", label: "Averses légères" },
  81: { icon: "🌧️", label: "Averses modérées" },
  82: { icon: "⛈️", label: "Averses violentes" },
  85: { icon: "❄️", label: "Averses de neige légères" },
  86: { icon: "❄️", label: "Averses de neige fortes" },
  95: { icon: "⛈️", label: "Orage" },
  96: { icon: "⛈️", label: "Orage avec grêle légère" },
  99: { icon: "⛈️", label: "Orage avec grêle forte" }
};

// Codes considérés comme "il pleut / va pleuvoir" pour l'alerte tournée —
// bruine, pluie, averses, orage (pas le brouillard ni la neige, sans objet
// terrain en Côte d'Ivoire).
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

// Seuil (%) au-delà duquel la probabilité de pluie du jour déclenche
// l'alerte avant tournée, même si le ciel est dégagé au moment du départ.
const RAIN_PROBABILITY_ALERT_PCT = 50;

export function describeWeatherCode(code) {
  return WEATHER_CODES[code] || { icon: "🌡️", label: "Conditions inconnues" };
}

function roundCoord(v) {
  return Number(v.toFixed(CACHE_COORD_PRECISION));
}

function cacheKey(lat, lon) {
  return `weather_${roundCoord(lat)}_${roundCoord(lon)}`;
}

/**
 * Normalise la réponse Open-Meteo brute en un objet stable pour l'UI,
 * indépendant du format exact de l'API (si Open-Meteo change ses champs,
 * un seul endroit à adapter).
 */
function normalize(raw) {
  const current = raw.current || {};
  const daily = raw.daily || {};

  return {
    current: {
      temperatureC: current.temperature_2m ?? null,
      precipitationMm: current.precipitation ?? 0,
      weatherCode: current.weather_code ?? null,
      windSpeedKmh: current.wind_speed_10m ?? null,
      isDay: current.is_day === 1
    },
    today: {
      weatherCode: daily.weather_code?.[0] ?? null,
      tempMaxC: daily.temperature_2m_max?.[0] ?? null,
      tempMinC: daily.temperature_2m_min?.[0] ?? null,
      rainProbabilityPct: daily.precipitation_probability_max?.[0] ?? null,
      precipitationSumMm: daily.precipitation_sum?.[0] ?? null
    },
    tomorrow: {
      weatherCode: daily.weather_code?.[1] ?? null,
      tempMaxC: daily.temperature_2m_max?.[1] ?? null,
      tempMinC: daily.temperature_2m_min?.[1] ?? null,
      rainProbabilityPct: daily.precipitation_probability_max?.[1] ?? null,
      precipitationSumMm: daily.precipitation_sum?.[1] ?? null
    },
    fetchedAt: Date.now()
  };
}

async function fetchFromNetwork(lat, lon) {
  const url = `${API_URL}?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum" +
    "&timezone=auto&forecast_days=2";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return normalize(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Récupère la météo à une position, avec cache IndexedDB.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{maxAgeMs?: number}} [options]
 * @returns {Promise<object & {stale?: boolean}>} lève seulement si aucun
 *   réseau ET aucune entrée de cache (même périmée) n'est disponible.
 */
export async function getWeather(lat, lon, { maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  const key = cacheKey(lat, lon);
  const cached = await getMeta(key);
  const cacheFresh = cached && Date.now() - cached.fetchedAt < maxAgeMs;

  if (cacheFresh) return cached;

  try {
    const fresh = await fetchFromNetwork(lat, lon);
    await setMeta(key, fresh);
    return fresh;
  } catch (err) {
    log.warn("WEATHER", "fetch échoué, repli sur cache:", err?.message || err);
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

/**
 * Message d'alerte pluie à afficher avant de démarrer une tournée, ou null
 * si aucune pluie significative n'est prévue aujourd'hui.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{message:string, icon:string}|null>}
 */
export async function getRainAlert(lat, lon) {
  let weather;
  try {
    weather = await getWeather(lat, lon);
  } catch {
    // Pas de réseau ET pas de cache : pas d'alerte plutôt que de bloquer
    // le démarrage de la tournée sur une info indisponible.
    return null;
  }

  const { current, today } = weather;
  const currentlyRaining = RAIN_CODES.has(current.weatherCode) && current.precipitationMm > 0;
  const highRainProbability = Number.isFinite(today.rainProbabilityPct) && today.rainProbabilityPct >= RAIN_PROBABILITY_ALERT_PCT;

  if (!currentlyRaining && !highRainProbability) return null;

  if (currentlyRaining) {
    return {
      icon: "🌧️",
      message: "Il pleut actuellement — pistes non bitumées potentiellement glissantes ou impraticables."
    };
  }

  return {
    icon: "🌦️",
    message: `Pluie probable aujourd'hui (${Math.round(today.rainProbabilityPct)}% de risque) — prévoyez un itinéraire de repli si vous couvrez des zones non bitumées.`
  };
}
