// Filtres, statistiques et couverture des quartiers (extrait de appView.js).
import { store } from "../core/store.js";
import { renderMarkers } from "../modules/census/markers.js";
import { toastError } from "../core/toast.js";
import { removeTargetZone } from "../core/targetZones.js";
import { escapeHtml } from "../core/utils.js";
import { computeStats } from "../core/analytics.js";
import { filterPoints } from "../core/filters.js";

// Affiche "N résultats" uniquement quand un filtre restreint réellement la
// liste (recherche texte active) — sans ça le compteur répéterait en
// permanence le total déjà visible dans l'en-tête, sans apporter d'info.
export function updateSearchResultCount(search, filteredCount) {
  const el = document.getElementById("searchResultCount");
  if (!el) return;
  el.textContent = search
    ? `${filteredCount} résultat${filteredCount > 1 ? "s" : ""}`
    : "";
}

export function applyFilters() {
  const filters = {
    city: document.getElementById("filterCity").value,
    quartier: document.getElementById("filterQuartier").value,
    block: document.getElementById("filterBlock").value,
    status: document.getElementById("filterStatus").value,
    visited: document.getElementById("filterVisited").value,
    // #searchBox retiré du header — le filtre "search" (filterPoints, core/filters.js)
    // reste pris en charge par cette clé si un futur point d'entrée la réintroduit.
    search: document.getElementById("searchBox")?.value.trim() || ""
  };
  store.set("filters", filters);

  // Filtre 100% LOCAL (#33) : aucune requête Supabase, on filtre les données
  // déjà en mémoire puis on met à jour les marqueurs.
  const points = store.get("points");
  const filtered = filterPoints(points, filters);
  updateSearchResultCount(filters.search, filtered.length);
  renderMarkers(filtered);
}

/**
 * Rendu des marqueurs conforme aux filtres actifs du store — utilisé par
 * l'abonnement "points" pour que l'arrivée de données fraîches (cache →
 * Supabase) ne réinitialise PAS visuellement le filtre choisi par l'agent.
 */
export function applyFiltersFromStore() {
  const filters = store.get("filters") || { city: "all", quartier: "all", block: "all", status: "all", visited: "all", search: "" };
  const filtered = filterPoints(store.get("points"), filters);
  updateSearchResultCount(filters.search, filtered.length);
  renderMarkers(filtered);
}

export function populateBlockFilter(points) {
  const select = document.getElementById("filterBlock");
  if (!select) return;
  const blocks = [...new Set(points.map(p => p.block))].sort((a, b) => a - b);
  const signature = blocks.join(",");
  // Idempotent : appelé à chaque arrivée de données (cache puis Supabase),
  // on ne reconstruit les options QUE si la liste des blocs a changé —
  // sinon la sélection courante de l'agent serait réinitialisée.
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const current = select.value;
  select.innerHTML = `<option value="all">Tous</option>`;
  blocks.forEach(b => {
    const opt = document.createElement("option");
    opt.value = String(b);
    opt.textContent = `Bloc ${String(b).padStart(2, "0")}`;
    select.appendChild(opt);
  });
  // Restaurer la sélection si elle existe toujours
  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

// Contrairement à "ville" (liste fermée gérée par l'admin, voir
// populateCityFilter), "quartier" reste un texte libre saisi par l'agent
// (censusFormModal.js) — la liste du filtre est donc dérivée des valeurs
// RÉELLEMENT présentes sur les points chargés, pas d'une table admin.
export function populateQuartierFilter(points) {
  const select = document.getElementById("filterQuartier");
  if (!select) return;
  const quartiers = [...new Set(points.map(p => (p.quartier || "").trim()).filter(Boolean))].sort();
  const signature = quartiers.join(",");
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const current = select.value;
  select.innerHTML = `<option value="all">Tous</option>` +
    quartiers.map(q => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("");
  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

// Source = liste admin (store.cities), pas les valeurs déjà vues sur les
// points : une ville tout juste ajoutée par l'admin doit apparaître dans le
// filtre même avant qu'aucun point n'y soit encore recensé.
export function populateCityFilter(cities) {
  const select = document.getElementById("filterCity");
  if (!select) return;
  const names = (cities || []).map(c => c.name).sort();
  const signature = names.join(",");
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const current = select.value;
  select.innerHTML = `<option value="all">Toutes</option>` +
    names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

// Cache du dernier calcul computeStats() : updateStats() et
// renderQuartierCoverage() sont appelées l'une après l'autre depuis les
// mêmes points d'entrée (chargement initial, abonnement "points"/
// "targetZones") mais SÉPARÉMENT depuis d'autres (renderQuartierCoverage
// seule après ajout/suppression de zone) — donc pas un simple "calculer une
// fois par tick". BUG corrigé (audit) : un cache existait déjà en intention
// (commentaire d'origine) mais n'était jamais relu, seulement réécrit —
// renderQuartierCoverage() refaisait TOUJOURS son propre computeStats().
// getStats() ci-dessous compare les RÉFÉRENCES points/targetZones du store
// (jamais mutées en place ailleurs dans le fichier, toujours remplacées via
// store.set() avec un nouveau tableau) pour ne recalculer que si l'un des
// deux a réellement changé depuis le dernier appel, peu importe lequel des
// deux appelants a déclenché ce dernier calcul.
let lastComputedStats = null;
let lastStatsPointsRef = null;
let lastStatsZonesRef = null;

export function getStats() {
  const points = store.get("points");
  const targetZones = store.get("targetZones");
  if (lastComputedStats && points === lastStatsPointsRef && targetZones === lastStatsZonesRef) {
    return lastComputedStats;
  }
  lastComputedStats = computeStats(points, targetZones);
  lastStatsPointsRef = points;
  lastStatsZonesRef = targetZones;
  return lastComputedStats;
}

export function updateStats() {
  const { visited, total, coveragePct } = getStats();
  const el = document.getElementById("statsHeader");
  if (el) {
    el.innerHTML = `
      <span>${visited} / ${total} visités (${coveragePct}%)</span>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${coveragePct}%"></div>
      </div>
    `;
  }
}

export function renderQuartierCoverage() {
  const container = document.getElementById("quartierCoverageList");
  if (!container) return;

  const targetZones = store.get("targetZones") || [];
  const stats = getStats();
  const rows = stats.byQuartier;
  // computeStats ne connaît pas les ids de zones : map nom -> id pour le
  // bouton de suppression des zones cibles.
  const zoneIdByName = new Map(targetZones.map(z => [z.name, z.id]));

  if (rows.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted);">Aucune zone définie pour l'instant — ajoutez-en une ci-dessous.</div>`;
    return;
  }

  // BUG CORRIGÉ : le nom du quartier n'avait AUCUNE couleur explicite — il
  // héritait donc de body { color: var(--text-primary) }, qui devient blanc
  // cassé en thème sombre. Sur le fond hardcodé clair de ce panneau
  // (--bg-surface), le résultat était un texte invisible (blanc sur quasi
  // blanc) : seuls le compteur et la barre de progression (déjà colorés en
  // dur) restaient visibles, laissant chaque ligne sans nom lisible.
  container.innerHTML = rows.map(r => {
    const color = r.total === 0 ? "var(--text-muted)" : r.pct < 40 ? "#e74c3c" : r.pct < 75 ? "#f1c40f" : "#2ecc71";
    const zoneId = zoneIdByName.get(r.quartier);
    const removeBtn = zoneId
      ? `<button type="button" class="remove-zone-btn" data-zone-id="${escapeHtml(zoneId)}" title="Retirer cette zone cible" aria-label="Retirer cette zone cible" style="border:none; background:none; color:var(--text-muted); cursor:pointer; font-size:13px; padding:0 2px;">✕</button>`
      : "";
    return `
      <div style="display:flex; align-items:center; gap:6px; font-size:12px;">
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);" title="${escapeHtml(r.quartier)}">${r.total === 0 ? "🎯 " : ""}${escapeHtml(r.quartier)}</span>
        <span style="color:var(--text-secondary); min-width:44px; text-align:right;">${r.visited}/${r.total}</span>
        <div style="width:44px; height:7px; border-radius:4px; background:var(--border); overflow:hidden; flex-shrink:0;">
          <div style="height:100%; width:${r.pct}%; background:${color}; border-radius:4px; transition:width 0.4s ease;"></div>
        </div>
        ${removeBtn}
      </div>
    `;
  }).join("");

  container.querySelectorAll(".remove-zone-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const zoneId = btn.dataset.zoneId;
      try {
        await removeTargetZone(zoneId);
        store.set("targetZones", (store.get("targetZones") || []).filter(z => z.id !== zoneId));
        renderQuartierCoverage();
      } catch (err) {
        toastError(err.message || "Impossible de retirer cette zone.");
      }
    });
  });
}

