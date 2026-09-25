// Exports CSV et rapport de tournée (extrait de appView.js).
import { store } from "../core/store.js";
import { toastInfo, toastWarning } from "../core/toast.js";
import { auditExportQuality } from "../core/exportQuality.js";
import { getPendingSyncs } from "../db/database.js";
import { mergeTourStopsWithLiveStatus, buildTourReportHtml, openTourReportPrintWindow } from "../modules/report/tourReport.js";
import { closeControls } from "./uiHelpers.js";

export async function exportCSV() {
  // Second verrou (le bouton est déjà masqué pour les non-admins) : au cas
  // où exportCSV() serait un jour appelée par un autre chemin que le clic
  // sur #exportBtn, l'export de données reste bloqué pour un compte agent.
  if (!store.get("ui.isAdmin")) {
    toastWarning("Export réservé aux comptes administrateur.");
    return;
  }
  const points = store.get("points");
  const pending = await getPendingSyncs();
  const quality = auditExportQuality(points, pending.length);
  const qualityEl = document.getElementById("exportQualitySummary");
  if (qualityEl) {
    qualityEl.hidden = false;
    qualityEl.textContent = `Contrôle qualité : ${quality.incompleteCount} incomplet(s), ${quality.pendingCount} en attente de sync, ${quality.duplicateCount} doublon(s) potentiel(s).`;
    qualityEl.classList.toggle("export-quality-warning", Object.values(quality).some(value => value > 0));
  }
  if (quality.incompleteCount || quality.pendingCount || quality.duplicateCount) {
    toastWarning(`Export autorisé avec avertissement : ${quality.incompleteCount} incomplet(s), ${quality.pendingCount} en attente, ${quality.duplicateCount} doublon(s) potentiel(s).`);
  }
  const header = ["id", "block", "name", "etablissement", "activityType", "tel", "city", "quartier", "address", "produits", "sexe", "status", "visite", "lat", "lon"];
  const rows = points.map(p => [
    p.id, p.block, p.name, p.etablissement, p.activityType, p.tel, p.city, p.quartier, p.address,
    p.produits, p.sexe, p.status, p.visited ? "oui" : "non", p.lat, p.lon
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `recensement_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  closeControls();
}

/**
 * Rapport PDF (impression navigateur) de la DERNIÈRE tournée démarrée
 * (store "tour.originalPoints", voir tour.js/store.js) — reste générable
 * après la fin de la tournée, jusqu'à ce qu'une nouvelle soit lancée.
 */
export function generateTourReport() {
  // Même double-verrou que exportCSV() ci-dessus : le bouton est déjà masqué
  // pour les non-admins, ce contrôle protège un éventuel autre point d'entrée.
  if (!store.get("ui.isAdmin")) {
    toastWarning("Rapport réservé aux comptes administrateur.");
    return;
  }

  const originalPoints = store.get("tour.originalPoints") || [];
  if (originalPoints.length === 0) {
    toastInfo("Aucune tournée effectuée pour le moment — lancez une tournée optimisée d'abord.");
    return;
  }

  const stops = mergeTourStopsWithLiveStatus(originalPoints, store.get("points"));
  const user = store.get("user");
  const html = buildTourReportHtml(stops, {
    agentName: store.get("ui.fullName"),
    agentEmail: user?.email,
    startedAt: store.get("tour.startedAt"),
    endedAt: store.get("tour.endedAt")
  });

  try {
    openTourReportPrintWindow(html);
  } catch (err) {
    toastWarning(err.message || "Impossible d'ouvrir la fenêtre d'impression.");
  }
  closeControls();
}

