/**
 * Rapport PDF "fiches recensées par agent" (calcul de paie), même approche
 * que tourReport.js : génération via impression navigateur (window.print()),
 * pas de librairie PDF supplémentaire. Réutilise openTourReportPrintWindow()
 * (générique, prend n'importe quel HTML) — voir modules/report/tourReport.js.
 */

import { escapeHtml } from "../../core/utils.js";

const PERIOD_LABELS = { day: "Aujourd'hui", week: "Cette semaine", month: "Ce mois", all: "Toute la période" };

/**
 * Début de la période (heure locale), null pour "all" (aucune borne).
 * "week" = 7 derniers jours glissants (aujourd'hui inclus), pas la semaine
 * calendaire — plus utile pour un calcul de paie récurrent que "depuis lundi".
 * @param {"day"|"week"|"month"|"all"} period
 * @param {Date} [now] injectable pour les tests
 */
export function agentReportPeriodStart(period, now = new Date()) {
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 6);
    return d;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

/**
 * Fiches recensées par un agent donné sur une période — utilisé pour le
 * calcul de la paie (voir appView.js, panneau "Comptes agents"). Filtre sur
 * createdAt (jamais réécrit par une édition ultérieure, voir upsertPoint()
 * dans db/database.js) : on compte ce que l'agent a RECENSÉ pendant la
 * période, pas ce qu'il a simplement modifié.
 * @param {object[]} points
 * @param {string} userId
 * @param {"day"|"week"|"month"|"all"} period
 * @param {Date} [now] injectable pour les tests
 */
export function computeAgentPeriodPoints(points, userId, period, now = new Date()) {
  const start = agentReportPeriodStart(period, now);
  return (points || []).filter(p => {
    if (p.createdBy !== userId) return false;
    if (!start) return true;
    // Pas de createdAt connu (fiche importée avant ce correctif) : exclue
    // d'une période précise plutôt que comptée à tort dans "Aujourd'hui".
    if (!p.createdAt) return false;
    return new Date(p.createdAt) >= start;
  });
}

function formatDateFr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Kilomètres parcourus par un agent sur une période, approximés à partir des
 * tournées optimisées terminées (voir tour.js: stopTour()). N'inclut PAS
 * tout déplacement terrain — seulement les distances des tournées lancées
 * via la fonction "Tournée optimisée" ; limite assumée en l'absence de suivi
 * GPS historique dans ce projet.
 * @param {object[]} sessions sortie de loadTourSessions() (core/tourSessions.js)
 * @param {string} userId
 * @param {"day"|"week"|"month"|"all"} period
 * @param {Date} [now] injectable pour les tests
 */
export function computeAgentPeriodDistance(sessions, userId, period, now = new Date()) {
  const start = agentReportPeriodStart(period, now);
  return (sessions || [])
    .filter(s => s.userId === userId && (!start || new Date(s.startedAt) >= start))
    .reduce((sum, s) => sum + (s.distanceKm || 0), 0);
}

/**
 * @param {object[]} points fiches déjà filtrées (agent + période)
 * @param {{agentName?:string, period?:string, generatedAt?:string, distanceKm?:number}} [meta]
 * @returns {string} document HTML complet, prêt à imprimer
 */
export function buildAgentReportHtml(points, meta = {}) {
  const safePoints = Array.isArray(points) ? points : [];
  const visitedCount = safePoints.filter(p => p.visited).length;
  const total = safePoints.length;
  const hasDistance = Number.isFinite(meta.distanceKm) && meta.distanceKm > 0;

  const rows = safePoints.map(p => `
    <tr>
      <td>${formatDateFr(p.createdAt)}</td>
      <td>${escapeHtml(p.name || "—")}</td>
      <td>${escapeHtml(p.city || "—")}</td>
      <td>${escapeHtml(p.quartier || "—")}</td>
      <td>${escapeHtml(p.status || "—")}</td>
      <td class="${p.visited ? "ok" : "pending"}">${p.visited ? "&#10003; Visité" : "Non visité"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport agent — CensGo ANAREKA-CI</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; padding: 28px; }
  h1 { color: #1a3d2b; font-size: 19px; margin: 0 0 2px; }
  .subtitle { color: #64748b; font-size: 12.5px; margin-bottom: 18px; line-height: 1.5; }
  .summary { display: flex; gap: 28px; margin-bottom: 20px; }
  .summary div { font-size: 12px; color: #64748b; }
  .summary b { display: block; font-size: 20px; color: #1a3d2b; line-height: 1.3; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f8fafc; color: #334155; }
  td.ok { color: #16a34a; font-weight: 600; }
  td.pending { color: #94a3b8; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Rapport de recensement — ${escapeHtml(meta.agentName || "Agent")}</h1>
  <div class="subtitle">
    Période&nbsp;: ${escapeHtml(PERIOD_LABELS[meta.period] || "Toute la période")}<br>
    Généré le ${formatDateFr(meta.generatedAt || new Date().toISOString())}
  </div>
  <div class="summary">
    <div><b>${total}</b>fiche${total > 1 ? "s" : ""} recensée${total > 1 ? "s" : ""}</div>
    <div><b>${visitedCount}</b>visitée${visitedCount > 1 ? "s" : ""}</div>
    ${hasDistance ? `<div><b>${meta.distanceKm.toFixed(1)} km</b>parcourus (tournées optimisées)</div>` : ""}
  </div>
  <table>
    <thead><tr><th>Date</th><th>Nom</th><th>Ville</th><th>Quartier</th><th>Statut</th><th>Visite</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Aucune fiche sur cette période.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}
