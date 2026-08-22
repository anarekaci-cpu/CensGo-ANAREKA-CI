/**
 * Capteur d'orientation + sélection des cibles radar pour la boussole
 * terrain. Séparé de compassView.js afin que la vue reste un pur DOM
 * consommateur de store, et que cette logique reste testable seule.
 */
import { store } from "../../core/store.js";
import { haversineKm, bearingDeg } from "../../core/geo.js";

const RADAR_RADIUS_KM = 3;

let active = false;
let orientationHandler = null;
let usingAbsoluteOrientation = false;

function handleOrientationEvent(event) {
  let heading = null;

  if (typeof event.webkitCompassHeading === "number") {
    // Safari iOS : déjà un cap vrai (0 = Nord), pas besoin d'inversion.
    heading = event.webkitCompassHeading;
  } else if (Number.isFinite(event.alpha)) {
    heading = 360 - event.alpha;
  }

  if (heading == null || !Number.isFinite(heading)) return;

  store.set("geo.heading", ((heading % 360) + 360) % 360);
}

/** @returns {boolean} true si le capteur d'orientation est actuellement actif */
export function isCompassActive() {
  return active;
}

/**
 * Active le capteur d'orientation (demande l'autorisation si nécessaire,
 * requis par iOS 13+ suite à un geste utilisateur).
 * @returns {Promise<boolean>} true si l'activation a réussi
 */
export async function enableCompass() {
  if (active) return true;

  if (typeof DeviceOrientationEvent === "undefined") {
    store.set("geo.compassError", "Capteur d'orientation non disponible sur cet appareil.");
    return false;
  }

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") {
        store.set("geo.compassError", "Autorisation boussole refusée.");
        return false;
      }
    } catch {
      store.set("geo.compassError", "Impossible d'accéder au capteur d'orientation.");
      return false;
    }
  }

  usingAbsoluteOrientation = "ondeviceorientationabsolute" in window;
  orientationHandler = handleOrientationEvent;
  window.addEventListener(
    usingAbsoluteOrientation ? "deviceorientationabsolute" : "deviceorientation",
    orientationHandler,
    true
  );

  active = true;
  store.set("geo.compassActive", true);
  store.set("geo.compassError", null);
  return true;
}

/** Désactive le capteur d'orientation et retire l'écouteur. */
export function disableCompass() {
  if (orientationHandler) {
    window.removeEventListener(
      usingAbsoluteOrientation ? "deviceorientationabsolute" : "deviceorientation",
      orientationHandler,
      true
    );
    orientationHandler = null;
  }
  active = false;
  store.set("geo.compassActive", false);
}

/**
 * Points non visités les plus proches de la position actuelle, dans un
 * rayon de RADAR_RADIUS_KM, triés par distance croissante.
 *
 * @param {number} [maxCount=5]
 * @returns {{point: object, distanceKm: number, bearing: number}[]}
 */
export function getRadarTargets(maxCount = 5) {
  const userPos = store.get("geo.position");
  if (!userPos) return [];

  const points = store.get("points") || [];
  return points
    .filter(p => p && !p.visited && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map(p => ({
      point: p,
      distanceKm: haversineKm(userPos.lat, userPos.lng, p.lat, p.lon),
      bearing: bearingDeg(userPos.lat, userPos.lng, p.lat, p.lon)
    }))
    .filter(entry => entry.distanceKm <= RADAR_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxCount);
}
