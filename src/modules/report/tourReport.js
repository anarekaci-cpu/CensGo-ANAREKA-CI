/**
 * Rapport PDF de tournée (Priorité 4 roadmap, cadré avec l'utilisateur) :
 * liste imprimable des arrêts d'une tournée optimisée (tour.js) avec leur
 * statut de visite. Génération via impression navigateur (window.print())
 * plutôt qu'une librairie PDF — pas de dépendance supplémentaire, cohérent
 * avec le souci de poids de bundle déjà documenté (P0.3 roadmap).
 *
 * "tour.points" (tour.js) perd chaque arrêt dès qu'il est visité — inutile
 * pour un rapport de fin de tournée. "tour.originalPoints" (snapshot figé au
 * démarrage) donne la liste complète ; ce module la recroise avec l'état
 * VIVANT de chaque point (store "points") pour savoir qui a réellement été
 * visité, et quand (point.updatedAt, mis à jour par updatePointVisit()).
 */

import { normalizePointId, escapeHtml } from "../../core/utils.js";

/**
 * @param {object[]} originalPoints snapshot figé (tour.originalPoints)
 * @param {object[]} livePoints état courant (store "points")
 * @returns {object[]} arrêts enrichis, dans l'ordre original de la tournée
 */
export function mergeTourStopsWithLiveStatus(originalPoints, livePoints) {
  const liveById = new Map(
    (Array.isArray(livePoints) ? livePoints : []).map(p => [normalizePointId(p.id), p])
  );

  return (Array.isArray(originalPoints) ? originalPoints : []).map((snapshot, i) => {
    const live = liveById.get(normalizePointId(snapshot.id));
    const visited = live?.visited === true;
    return {
      order: i + 1,
      id: snapshot.id,
      name: live?.name ?? snapshot.name ?? "",
      quartier: live?.quartier ?? snapshot.quartier ?? "",
      tel: live?.tel ?? snapshot.tel ?? "",
      status: live?.status ?? snapshot.status ?? "NON DEFINI",
      visited,
      // Un point retiré depuis (suppression, etc.) n'a plus d'entrée dans
      // "livePoints" : `live` est alors undefined et le point reste marqué
      // "non visité" plutôt que de deviner un horodatage.
      updatedAt: visited ? (live.updatedAt || null) : null
    };
  });
}

function formatDateTimeFr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * @param {object[]} stops sortie de mergeTourStopsWithLiveStatus()
 * @param {{agentName?:string, agentEmail?:string, startedAt?:string, endedAt?:string, generatedAt?:string}} [meta]
 * @returns {string} document HTML complet, prêt à imprimer
 */
export function buildTourReportHtml(stops, meta = {}) {
  const safeStops = Array.isArray(stops) ? stops : [];
  const visitedCount = safeStops.filter(s => s.visited).length;
  const total = safeStops.length;
  const coveragePct = total > 0 ? Math.round((visitedCount / total) * 100) : 0;

  const rows = safeStops.map(s => `
    <tr>
      <td>${s.order}</td>
      <td>${escapeHtml(s.name || "—")}</td>
      <td>${escapeHtml(s.quartier || "—")}</td>
      <td>${escapeHtml(s.tel || "—")}</td>
      <td>${escapeHtml(s.status || "—")}</td>
      <td class="${s.visited ? "ok" : "pending"}">${s.visited ? "&#10003; Visité" : "Non visité"}</td>
      <td>${formatDateTimeFr(s.updatedAt)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport de tournée — CensGo ANAREKA-CI</title>
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
  <h1>Rapport de tournée — CensGo ANAREKA-CI</h1>
  <div class="subtitle">
    Agent&nbsp;: ${escapeHtml(meta.agentName || meta.agentEmail || "—")}<br>
    Démarrée&nbsp;: ${formatDateTimeFr(meta.startedAt)} — ${meta.endedAt ? "Terminée : " + formatDateTimeFr(meta.endedAt) : "En cours"}<br>
    Généré le ${formatDateTimeFr(meta.generatedAt || new Date().toISOString())}
  </div>
  <div class="summary">
    <div><b>${total}</b>arrêts</div>
    <div><b>${visitedCount}</b>visités</div>
    <div><b>${coveragePct}%</b>couverture</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Nom</th><th>Quartier</th><th>Téléphone</th><th>Statut</th><th>Visite</th><th>Heure de passage</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Aucun arrêt.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

/**
 * Ouvre une fenêtre d'impression avec le rapport déjà généré. Séparé de
 * buildTourReportHtml() pour rester testable sans DOM/window.
 *
 * @param {string} html
 * @throws {Error} si le navigateur bloque l'ouverture de la fenêtre (popup)
 */
export function openTourReportPrintWindow(html) {
  const printWindow = window.open("", "_blank", "width=850,height=1000");
  if (!printWindow) {
    throw new Error("Fenêtre d'impression bloquée par le navigateur — autorisez les popups pour ce site.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  // onload plutôt qu'un appel print() immédiat : le contenu doit être
  // entièrement posé dans le document avant que la boîte de dialogue
  // d'impression du navigateur ne capture la mise en page.
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
  return printWindow;
}
