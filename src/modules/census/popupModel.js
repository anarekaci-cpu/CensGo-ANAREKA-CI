import { haversineKm } from "../../core/geo.js";
import { formatDist } from "./distFormat.js";

/**
 * Modèle de popup (Problème #1) — fonction PURE, testée unitairement.
 *
 * Construit la totalité des champs affichables d'une fiche à partir du point
 * normalisé + de la position utilisateur. Le DOM (buildPopup dans markers.js)
 * ne fait plus qu'appliquer ce modèle : aucune logique de donnée dans le
 * rendu, donc aucun risque qu'un champ calculé diverge entre deux points.
 *
 * @param {object} point - point normalisé (store)
 * @param {{lat:number, lng:number}|null} userPos - position GPS courante
 * @returns {object} modèle prêt à rendre
 */
export function buildPopupModel(point, userPos) {
  const hasCoords = point.lat != null && point.lon != null;

  let distanceKm = null;
  if (userPos && hasCoords) {
    distanceKm = haversineKm(userPos.lat, userPos.lng, point.lat, point.lon);
  }

  return {
    id: point.id,
    order: point.order,
    block: point.block,
    name: point.name || "(sans nom)",
    tel: point.tel || "",
    address: point.address || "",
    quartier: point.quartier || "",
    etablissement: point.etablissement || "",
    activityType: point.activityType || "",
    produits: point.produits || "",
    sexe: point.sexe || "",
    status: point.status,
    visited: !!point.visited,
    lat: hasCoords ? point.lat : null,
    lon: hasCoords ? point.lon : null,
    // Dates : recensement (création) + dernière mise à jour
    createdAt: formatDate(point.createdAt),
    updatedAt: formatDate(point.updatedAt),
    // Agent ayant recensé + zone de rattachement
    agent: point.createdBy || "",
    zone: point.zone || "",
    // Distance par rapport à la position actuelle de l'agent
    distanceLabel: distanceKm != null ? `📍 ${formatDist(distanceKm)} de vous` : ""
  };
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
