/**
 * Trafic heuristique — pas de donnée trafic temps réel fiable et gratuite
 * disponible en Côte d'Ivoire (voir ROADMAP_MODERNISATION.md, Priorité 2).
 * En attendant une solution commerciale (TomTom Traffic, couverture Abidjan
 * à valider), on ajuste la vitesse moyenne du mode voiture selon l'heure de
 * la journée — une estimation, pas une mesure réelle, mais plus honnête
 * qu'une vitesse constante aux heures de pointe Abidjan/Bingerville.
 *
 * Module séparé et testable en isolation, plutôt que codé en dur dans
 * routing.js — voir CONFIG.TRAFFIC_RUSH_HOUR_FACTOR pour ajuster le facteur
 * de ralentissement sans toucher au code.
 */

import { CONFIG } from "../../core/config.js";

// Heures de pointe Abidjan/Bingerville : trajet domicile-travail le matin,
// retour en fin de journée. Bornes en heure LOCALE de l'appareil (l'app
// n'a d'usage qu'en Côte d'Ivoire, pas de gestion de fuseau horaire).
const MORNING_RUSH = { startHour: 7, endHour: 9 };
const EVENING_RUSH = { startHour: 17, endHour: 19 };

function isWithinHour(hour, range) {
  return hour >= range.startHour && hour < range.endHour;
}

/**
 * Facteur de ralentissement à appliquer à la vitesse moyenne voiture pour
 * `date` (1 = pas de ralentissement, >1 = plus lent).
 *
 * @param {Date} [date]
 * @returns {number}
 */
export function getRushHourFactor(date = new Date()) {
  const hour = date.getHours();
  if (isWithinHour(hour, MORNING_RUSH) || isWithinHour(hour, EVENING_RUSH)) {
    return CONFIG.TRAFFIC_RUSH_HOUR_FACTOR;
  }
  return 1;
}

/**
 * @param {Date} [date]
 * @returns {boolean} true si `date` tombe dans une plage d'heure de pointe.
 */
export function isRushHour(date = new Date()) {
  return getRushHourFactor(date) > 1;
}

/**
 * Vitesse moyenne voiture (m/s) ajustée à l'heure de la journée.
 *
 * @param {number} baseSpeedMps vitesse hors heure de pointe
 * @param {Date} [date]
 * @returns {number}
 */
export function getHeuristicCarSpeedMps(baseSpeedMps, date = new Date()) {
  return baseSpeedMps / getRushHourFactor(date);
}

/**
 * Ajuste une durée déjà connue (ex: renvoyée par un fournisseur d'itinéraire
 * réel comme OpenRouteService) pour tenir compte de l'heure de pointe — même
 * ralentissement que getHeuristicCarSpeedMps(), exprimé directement sur une
 * durée plutôt que sur une vitesse. Mode voiture uniquement.
 *
 * @param {number} durationSeconds
 * @param {"foot"|"bike"|"car"} mode
 * @param {Date} [date]
 * @returns {number}
 */
export function applyRushHourDurationFactor(durationSeconds, mode, date = new Date()) {
  return mode === "car" ? durationSeconds * getRushHourFactor(date) : durationSeconds;
}
