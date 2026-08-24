import { CONFIG } from "../../core/config.js";

const MORNING_RUSH = { startHour: 7, endHour: 9 };
const EVENING_RUSH = { startHour: 17, endHour: 19 };

/**
 * Estimation horaire locale pour Abidjan/Bingerville, pas une mesure de trafic
 * en direct. Le facteur ne s'applique qu'au mode voiture.
 */
export function getTrafficFactor(date = new Date(), mode = "car") {
  if (mode !== "car") return 1;
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) return 1;
  const hour = date.getHours();
  const inRush = (hour >= MORNING_RUSH.startHour && hour < MORNING_RUSH.endHour) ||
    (hour >= EVENING_RUSH.startHour && hour < EVENING_RUSH.endHour);
  return inRush ? CONFIG.TRAFFIC_RUSH_HOUR_FACTOR : 1;
}

export function applyTrafficFactor(durationSeconds, mode, date = new Date()) {
  return durationSeconds * getTrafficFactor(date, mode);
}

export function getHeuristicCarSpeedMps(baseSpeedMps, date = new Date()) {
  return baseSpeedMps / getTrafficFactor(date, "car");
}