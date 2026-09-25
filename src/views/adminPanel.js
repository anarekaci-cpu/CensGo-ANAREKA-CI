// Panneau admin : comptes agents, rapport de fiches, villes, invitations,
// suivi (extrait de appView.js).
import { store } from "../core/store.js";
import { renderErrorsPanel } from "../modules/admin/errorsPanel.js";
import { upsertPoint } from "../db/database.js";
import { toastInfo, toastWarning, toastError, toastSuccess } from "../core/toast.js";
import { addCity, removeCity } from "../core/cities.js";
import { listInvites, createInvite, revokeInvite, buildInviteUrl } from "../core/invites.js";
import { escapeHtml } from "../core/utils.js";
import { openTourReportPrintWindow } from "../modules/report/tourReport.js";
import { buildAgentReportHtml, computeAgentPeriodPoints, computeAgentPeriodDistance } from "../modules/report/agentReport.js";
import { getSignedPhotoUrl } from "../core/censusPhotos.js";
import { closeControls } from "./uiHelpers.js";

const ROLE_LABELS = { agent: "Agent", admin: "Administrateur" };

function renderAgentRow(row, currentUserId, stats) {
  const isSelf = row.user_id === currentUserId;
  const name = escapeHtml(row.full_name || "Sans nom renseigné");
  const email = row.email ? escapeHtml(row.email) : "";
  const number = row.agent_number != null ? `#${row.agent_number}` : "—";
  const statusLabel = row.role ? ROLE_LABELS[row.role] : "En attente de validation";
  const statusClass = row.role === "admin" ? "role-admin" : row.role === "agent" ? "role-agent" : "role-pending";
  const agentStats = stats?.get(row.user_id);
  const statsHTML = row.role === "agent" && agentStats
    ? `<div class="agent-row-stats">📋 ${agentStats.created} recensement${agentStats.created > 1 ? "s" : ""}${agentStats.created ? ` · ✅ ${agentStats.visited} visité${agentStats.visited > 1 ? "s" : ""}` : ""}</div>`
    : "";

  const actions = [];
  // Rapport de fiches recensées — utile pour calculer la paie d'un agent sur
  // une période. Visible dès qu'un compte a un rôle attribué (agent ou
  // admin) ; un compte en attente n'a par définition encore rien recensé.
  if (row.role) {
    actions.push(`<button class="agent-action-btn agent-report-btn" data-user-id="${escapeHtml(row.user_id)}" data-user-name="${name}">📋 Fiches</button>`);
  }
  if (!isSelf) {
    if (!row.role) {
      actions.push(`<button class="agent-action-btn agent-approve" data-user-id="${escapeHtml(row.user_id)}" data-role="agent">✅ Approuver (agent)</button>`);
      actions.push(`<button class="agent-action-btn agent-promote" data-user-id="${escapeHtml(row.user_id)}" data-role="admin">👑 Approuver (admin)</button>`);
    } else if (row.role === "agent") {
      actions.push(`<button class="agent-action-btn agent-promote" data-user-id="${escapeHtml(row.user_id)}" data-role="admin">👑 Promouvoir admin</button>`);
      actions.push(`<button class="agent-action-btn agent-revoke" data-user-id="${escapeHtml(row.user_id)}" data-role="">⛔ Révoquer</button>`);
    } else {
      actions.push(`<button class="agent-action-btn agent-revoke" data-user-id="${escapeHtml(row.user_id)}" data-role="agent">⬇️ Rétrograder en agent</button>`);
    }
  }

  return `
    <div class="agent-row">
      <div class="agent-row-info">
        <span class="agent-number-badge">${number}</span>
        <div>
          <div class="agent-row-name">${name}${isSelf ? " (vous)" : ""}</div>
          ${email ? `<div class="agent-row-email">${email}</div>` : ""}
          <div class="agent-row-status ${statusClass}">${statusLabel}</div>
          ${statsHTML}
        </div>
      </div>
      <div class="agent-row-actions">${actions.join("")}</div>
    </div>
  `;
}

// Statistiques par agent (nb de points recensés / visités) calculées côté
// client à partir de store.get("points") — déjà chargés pour la carte
// partagée, donc aucune requête ni fonction SQL supplémentaire nécessaire.
function computeAgentStats() {
  const stats = new Map();
  const points = store.get("points") || [];
  for (const p of points) {
    if (!p.createdBy) continue;
    let entry = stats.get(p.createdBy);
    if (!entry) {
      entry = { created: 0, visited: 0 };
      stats.set(p.createdBy, entry);
    }
    entry.created += 1;
    if (p.visited) entry.visited += 1;
  }
  return stats;
}

// --- Rapport de fiches par agent (calcul de paie) ---
// Période au choix de l'admin (jour/semaine/mois/tout), voir #agentReportModal.
// "createdAt" (jamais réécrit par une édition ultérieure, voir upsertPoint())
// est la seule date pertinente ici : on paie l'agent pour les fiches qu'il a
// RECENSÉES pendant la période, pas pour celles qu'il a simplement modifiées.
let agentReportUserId = null;
let agentReportUserName = "";
let agentReportPeriod = "all";

export function renderAgentReport() {
  const table = document.getElementById("agentReportTable");
  const summary = document.getElementById("agentReportSummary");
  const title = document.getElementById("agentReportTitle");
  if (!table || !agentReportUserId) return;
  if (title) title.textContent = `Fiches recensées — ${agentReportUserName}`;

  const matched = computeAgentPeriodPoints(store.get("points"), agentReportUserId, agentReportPeriod)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const visited = matched.filter(p => p.visited).length;
  const distanceKm = computeAgentPeriodDistance(store.get("tourSessions"), agentReportUserId, agentReportPeriod);

  if (summary) {
    summary.innerHTML = `<span>📋 ${matched.length} fiche${matched.length > 1 ? "s" : ""}</span><span>✅ ${visited} visitée${visited > 1 ? "s" : ""}</span>` +
      (distanceKm > 0 ? `<span>🚶 ${distanceKm.toFixed(1)} km parcourus</span>` : "");
  }

  if (matched.length === 0) {
    table.innerHTML = `<div class="agents-list-loading">Aucune fiche sur cette période.</div>`;
    return;
  }

  table.innerHTML = `
    <table class="agent-report-html-table">
      <thead><tr><th>Date</th><th>Nom</th><th>Ville</th><th>Quartier</th><th>Statut</th><th>Visité</th><th>Photo</th></tr></thead>
      <tbody>
        ${matched.map(p => `
          <tr>
            <td>${p.createdAt ? new Date(p.createdAt).toLocaleDateString("fr-FR") : "—"}</td>
            <td>${escapeHtml(p.name || "—")}</td>
            <td>${escapeHtml(p.city || "—")}</td>
            <td>${escapeHtml(p.quartier || "—")}</td>
            <td>${escapeHtml(p.status || "—")}</td>
            <td>${p.visited ? "✅" : "—"}</td>
            <td>${p.photoPath
              ? `<button type="button" class="photo-view-btn" data-photo-path="${escapeHtml(p.photoPath)}" title="Voir la photo">📷</button>`
              : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function exportAgentReportCSV() {
  if (!agentReportUserId) return;
  const matched = computeAgentPeriodPoints(store.get("points"), agentReportUserId, agentReportPeriod);
  if (matched.length === 0) {
    toastWarning("Aucune fiche à exporter sur cette période.");
    return;
  }
  const header = ["date_creation", "id", "name", "etablissement", "city", "quartier", "tel", "status", "visite"];
  const rows = matched.map(p => [
    p.createdAt || "", p.id, p.name, p.etablissement, p.city, p.quartier, p.tel, p.status, p.visited ? "oui" : "non"
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const periodSlug = { day: "jour", week: "semaine", month: "mois", all: "tout" }[agentReportPeriod] || "tout";
  a.download = `fiches_${agentReportUserName.replace(/[^a-z0-9]+/gi, "_")}_${periodSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAgentReportPdf() {
  if (!agentReportUserId) return;
  const matched = computeAgentPeriodPoints(store.get("points"), agentReportUserId, agentReportPeriod)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (matched.length === 0) {
    toastWarning("Aucune fiche à imprimer sur cette période.");
    return;
  }
  const distanceKm = computeAgentPeriodDistance(store.get("tourSessions"), agentReportUserId, agentReportPeriod);
  const html = buildAgentReportHtml(matched, { agentName: agentReportUserName, period: agentReportPeriod, distanceKm });
  try {
    openTourReportPrintWindow(html);
  } catch (err) {
    toastError(err.message || "Impossible d'ouvrir la fenêtre d'impression.");
  }
}

async function refreshAgentsList() {
  const list = document.getElementById("agentsList");
  const summary = document.getElementById("agentsSummary");
  if (!list) return;
  list.innerHTML = `<div class="agents-list-loading">Chargement des comptes…</div>`;
  if (summary) summary.innerHTML = "";
  try {
    const { fetchAllAccounts } = await import("../modules/admin/roleManager.js");
    const rows = await fetchAllAccounts();
    const currentUserId = store.get("user")?.id;
    if (rows.length === 0) {
      list.innerHTML = `<div class="agents-list-loading">Aucun compte inscrit pour le moment.</div>`;
      return;
    }
    const stats = computeAgentStats();
    if (summary) {
      const pending = rows.filter(r => !r.role).length;
      const agents = rows.filter(r => r.role === "agent").length;
      const admins = rows.filter(r => r.role === "admin").length;
      const totalPoints = store.get("points")?.length || 0;
      summary.innerHTML = `
        <span>👤 ${agents} agent${agents > 1 ? "s" : ""}</span>
        <span>👑 ${admins} admin${admins > 1 ? "s" : ""}</span>
        ${pending ? `<span class="agents-summary-pending">⏳ ${pending} en attente</span>` : ""}
        <span>📋 ${totalPoints} point${totalPoints > 1 ? "s" : ""} au total</span>
      `;
    }
    list.innerHTML = rows.map(r => renderAgentRow(r, currentUserId, stats)).join("");
  } catch (e) {
    list.innerHTML = `<div class="agents-list-loading">❌ ${escapeHtml(e.message || "Échec du chargement des comptes.")}</div>`;
  }
}

// Panneau admin "Villes" — même gate que le reste du modal agentsModal
// (accessible seulement via manageAgentsBtn, lui-même caché aux non-admins,
// voir refreshAdminRole()) ; la seule autorité réelle reste la policy RLS
// "Admin can manage cities" (supabase/add_cities.sql) — ce check est un
// second verrou UX, pas une protection en soi.
export function renderCitiesList() {
  const container = document.getElementById("citiesList");
  if (!container) return;
  const cities = store.get("cities") || [];
  if (!store.get("ui.isAdmin")) {
    container.innerHTML = `<div class="cities-list-empty">Réservé aux administrateurs.</div>`;
    return;
  }
  if (cities.length === 0) {
    container.innerHTML = `<div class="cities-list-empty">Aucune ville configurée pour le moment.</div>`;
    return;
  }
  container.innerHTML = cities.map(c => `
    <div class="city-row">
      <span>${escapeHtml(c.name)}</span>
      <button type="button" class="remove-city-btn" data-city-id="${escapeHtml(c.id)}" title="Retirer cette ville" aria-label="Retirer cette ville">✕</button>
    </div>
  `).join("");
}

function formatInviteExpiry(iso) {
  if (!iso) return "sans expiration";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sans expiration";
  const expired = d.getTime() < Date.now();
  return `${expired ? "expiré le" : "expire le"} ${d.toLocaleDateString("fr-FR")}`;
}

async function renderInvitesList() {
  const container = document.getElementById("invitesList");
  if (!container) return;
  if (!store.get("ui.isAdmin")) {
    container.innerHTML = `<div class="cities-list-empty">Réservé aux administrateurs.</div>`;
    return;
  }
  container.innerHTML = `<div class="agents-list-loading">Chargement…</div>`;
  try {
    const invites = await listInvites();
    if (invites.length === 0) {
      container.innerHTML = `<div class="cities-list-empty">Aucun lien d'invitation généré pour le moment.</div>`;
      return;
    }
    container.innerHTML = invites.map(inv => {
      const usesLabel = inv.max_uses != null ? `${inv.uses}/${inv.max_uses} usages` : `${inv.uses} usage${inv.uses > 1 ? "s" : ""} (illimité)`;
      const expired = inv.expires_at && new Date(inv.expires_at).getTime() < Date.now();
      const exhausted = inv.max_uses != null && inv.uses >= inv.max_uses;
      const statusClass = inv.revoked ? "invite-revoked" : (expired || exhausted) ? "invite-exhausted" : "invite-active";
      const statusLabel = inv.revoked ? "Révoqué" : expired ? "Expiré" : exhausted ? "Épuisé" : "Actif";
      return `
        <div class="invite-row ${statusClass}">
          <div class="invite-row-info">
            <div class="invite-row-label">${escapeHtml(inv.label || "Sans étiquette")} <span class="invite-status-tag">${statusLabel}</span></div>
            <div class="invite-row-meta">${usesLabel} · ${formatInviteExpiry(inv.expires_at)}</div>
          </div>
          <div class="invite-row-actions">
            ${!inv.revoked ? `<button type="button" class="agent-action-btn invite-copy-btn" data-token="${escapeHtml(inv.token)}">🔗 Copier le lien</button>` : ""}
            ${!inv.revoked ? `<button type="button" class="agent-action-btn agent-revoke invite-revoke-btn" data-invite-id="${escapeHtml(inv.id)}">⛔ Révoquer</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="agents-list-loading">❌ ${escapeHtml(err.message || "Échec du chargement des invitations.")}</div>`;
  }
}

// Boutons de statut proposés lors de l'appel de suivi — mêmes libellés que
// le filtre existant (filterStatus), voir config.js pour les couleurs.
const FOLLOW_UP_STATUS_OPTIONS = [
  { value: "VERT (Joignable)", label: "✅ Joignable", cls: "follow-up-btn-vert" },
  { value: "JAUNE (Injoignable)", label: "📵 Injoignable", cls: "follow-up-btn-jaune" },
  { value: "ROUGE (Refus)", label: "🚫 Refus", cls: "follow-up-btn-rouge" },
  { value: "VIOLET (A verifier)", label: "❓ À vérifier", cls: "follow-up-btn-violet" }
];

/**
 * Liste des fiches recensées mais pas encore appelées par l'administration
 * (demande explicite) : le statut Vert/Jaune/Rouge/Violet ne reflète PLUS
 * une appréciation de l'agent terrain au moment du recensement — il
 * reflète l'appel de vérification que l'administration fait APRÈS coup
 * (confirmer que la personne a bien été informée, savoir si elle est
 * joignable). Un point neuf reste donc "NON DEFINI" (déjà la valeur par
 * défaut à la création, voir censusFormModal.js) tant que cet appel n'a
 * pas eu lieu — cette liste est simplement "tous les NON DEFINI", triée
 * par date de recensement décroissante pour faire remonter les nouvelles
 * fiches en premier (pas besoin d'un champ dédié "nouveau").
 */
export function renderFollowUpList() {
  const container = document.getElementById("followUpList");
  const summary = document.getElementById("followUpSummary");
  if (!container) return;

  const pending = (store.get("points") || [])
    .filter(p => (p.status || "NON DEFINI") === "NON DEFINI")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (summary) summary.textContent = `${pending.length} fiche${pending.length > 1 ? "s" : ""} en attente d'appel`;

  if (pending.length === 0) {
    container.innerHTML = `<div class="cities-list-empty">Tout le monde a été appelé — aucune fiche en attente.</div>`;
    return;
  }

  container.innerHTML = pending.map(p => {
    const tel = (p.tel || "").trim();
    const telLink = tel
      ? `<a href="tel:${escapeHtml(tel)}" class="tel">📞 ${escapeHtml(tel)}</a>`
      : `<span class="tel muted">Téléphone non renseigné</span>`;
    return `
      <div class="agent-row" data-point-id="${escapeHtml(p.id)}">
        <div class="agent-row-info">
          <div class="agent-row-name">${escapeHtml(p.name || "Sans nom")}</div>
          <div class="agent-row-email">${telLink}</div>
          <div class="agent-row-stats">${escapeHtml(p.quartier || p.city || "Quartier non renseigné")}</div>
        </div>
        <div class="agent-row-actions follow-up-actions">
          ${FOLLOW_UP_STATUS_OPTIONS.map(opt => `
            <button type="button" class="agent-action-btn follow-up-status-btn ${opt.cls}" data-point-id="${escapeHtml(p.id)}" data-status="${escapeHtml(opt.value)}">${opt.label}</button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

export function bindAgentsModalEvents() {
  // Rapport ouvert avant la fin du chargement des fiches (réseau terrain
  // lent) : il affichait "Aucune fiche" et ne se mettait jamais à jour.
  store.subscribe("points", () => {
    if (document.getElementById("agentReportModal")?.style.display === "block") renderAgentReport();
  });
  const openModal = openAgentsModal;
  const closeModal = () => {
    document.getElementById("agentsModal").style.display = "none";
  };

  document.getElementById("manageAgentsBtn")?.addEventListener("click", openModal);
  document.getElementById("agentsModalCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("agentsModalBackdrop")?.addEventListener("click", closeModal);

  document.getElementById("followUpBtn")?.addEventListener("click", () => {
    document.getElementById("followUpModal").style.display = "block";
    closeControls();
    renderFollowUpList();
  });
  const closeFollowUpModal = () => { document.getElementById("followUpModal").style.display = "none"; };
  document.getElementById("followUpModalCloseBtn")?.addEventListener("click", closeFollowUpModal);
  document.getElementById("followUpModalBackdrop")?.addEventListener("click", closeFollowUpModal);

  document.getElementById("followUpList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".follow-up-status-btn");
    if (!btn) return;
    const pointId = btn.dataset.pointId;
    const status = btn.dataset.status;
    const row = btn.closest(".agent-row");
    row?.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
      await upsertPoint({ id: pointId, status });
      // Reflet immédiat dans le store (même schéma que "Marquer visité"
      // ci-dessus) : le pin change de couleur sur la carte et la fiche
      // disparaît de cette liste sans attendre un rechargement complet.
      const points = (store.get("points") || []).map(p =>
        String(p.id) === String(pointId) ? { ...p, status } : p
      );
      store.set("points", points);
      renderFollowUpList();
      toastSuccess("Statut mis à jour après appel.");
    } catch (err) {
      toastError(err.message || "Échec de la mise à jour du statut.");
      row?.querySelectorAll("button").forEach(b => { b.disabled = false; });
    }
  });

  document.getElementById("agentsList")?.addEventListener("click", async (e) => {
    // Le bouton "📋 Fiches" partage la classe .agent-action-btn pour son style
    // mais n'a pas de data-role — il est géré séparément ci-dessous, jamais
    // par ce handler (qui appellerait sinon setUserRole(userId, null) et
    // révoquerait l'agent au lieu d'ouvrir son rapport).
    if (e.target.closest(".agent-report-btn")) return;
    const btn = e.target.closest(".agent-action-btn");
    if (!btn) return;
    const userId = btn.dataset.userId;
    const role = btn.dataset.role || null;
    btn.disabled = true;
    try {
      const { setUserRole } = await import("../modules/admin/roleManager.js");
      await setUserRole(userId, role);
      toastSuccess(role ? `Compte mis à jour (${ROLE_LABELS[role] || role}).` : "Compte révoqué — retour en attente de validation.");
      await refreshAgentsList();
    } catch (err) {
      toastError(err.message || "Échec de la mise à jour du compte.");
      btn.disabled = false;
    }
  });

  document.getElementById("agentsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".agent-report-btn");
    if (!btn) return;
    agentReportUserId = btn.dataset.userId;
    agentReportUserName = btn.dataset.userName || "Agent";
    agentReportPeriod = "all";
    document.querySelectorAll("#agentReportPeriodGroup .segment-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.period === "all");
      b.setAttribute("aria-pressed", b.dataset.period === "all" ? "true" : "false");
    });
    document.getElementById("agentReportModal").style.display = "block";
    renderAgentReport();
  });

  const closeReportModal = () => { document.getElementById("agentReportModal").style.display = "none"; };
  document.getElementById("agentReportCloseBtn")?.addEventListener("click", closeReportModal);
  document.getElementById("agentReportModalBackdrop")?.addEventListener("click", closeReportModal);

  document.querySelectorAll("#agentReportPeriodGroup .segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#agentReportPeriodGroup .segment-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      agentReportPeriod = btn.dataset.period;
      renderAgentReport();
    });
  });

  document.getElementById("agentReportExportBtn")?.addEventListener("click", exportAgentReportCSV);
  document.getElementById("agentReportPdfBtn")?.addEventListener("click", exportAgentReportPdf);

  document.getElementById("agentReportTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".photo-view-btn");
    if (!btn) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⌛";
    const url = await getSignedPhotoUrl(btn.dataset.photoPath);
    btn.disabled = false;
    btn.textContent = original;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toastWarning("Photo indisponible pour le moment.");
    }
  });

  document.getElementById("addCityBtn")?.addEventListener("click", async () => {
    if (!store.get("ui.isAdmin")) return;
    const input = document.getElementById("newCityInput");
    const name = input?.value.trim();
    if (!name) return;
    try {
      const city = await addCity(name);
      store.set("cities", [...(store.get("cities") || []), city].sort((a, b) => a.name.localeCompare(b.name)));
      renderCitiesList();
      input.value = "";
      toastSuccess(`"${name}" ajoutée à la liste des villes.`);
    } catch (err) {
      toastError(err.message || "Impossible d'ajouter cette ville.");
    }
  });
  document.getElementById("newCityInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addCityBtn")?.click();
  });

  document.getElementById("citiesList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".remove-city-btn");
    if (!btn || !store.get("ui.isAdmin")) return;
    const cityId = btn.dataset.cityId;
    btn.disabled = true;
    try {
      await removeCity(cityId);
      store.set("cities", (store.get("cities") || []).filter(c => c.id !== cityId));
      renderCitiesList();
      toastInfo("Ville retirée.");
    } catch (err) {
      toastError(err.message || "Impossible de retirer cette ville.");
      btn.disabled = false;
    }
  });

  document.getElementById("createInviteBtn")?.addEventListener("click", async (e) => {
    if (!store.get("ui.isAdmin")) return;
    const btn = e.currentTarget;
    const label = document.getElementById("newInviteLabel")?.value || "";
    const maxUsesRaw = document.getElementById("newInviteMaxUses")?.value;
    const expiresRaw = document.getElementById("newInviteExpiresDays")?.value;
    const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
    const expiresInDays = expiresRaw ? Number(expiresRaw) : null;
    btn.disabled = true;
    try {
      const invite = await createInvite({ label, maxUses, expiresInDays });
      await renderInvitesList();
      document.getElementById("newInviteLabel").value = "";
      const url = buildInviteUrl(invite.token);
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Lien d'invitation généré et copié dans le presse-papiers.");
      } catch {
        toastSuccess(`Lien d'invitation généré : ${url}`);
      }
    } catch (err) {
      toastError(err.message || "Impossible de générer un lien d'invitation.");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("invitesList")?.addEventListener("click", async (e) => {
    if (!store.get("ui.isAdmin")) return;
    const copyBtn = e.target.closest(".invite-copy-btn");
    if (copyBtn) {
      const url = buildInviteUrl(copyBtn.dataset.token);
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Lien copié dans le presse-papiers.");
      } catch {
        toastInfo(url);
      }
      return;
    }
    const revokeBtn = e.target.closest(".invite-revoke-btn");
    if (revokeBtn) {
      revokeBtn.disabled = true;
      try {
        await revokeInvite(revokeBtn.dataset.inviteId);
        await renderInvitesList();
        toastInfo("Invitation révoquée.");
      } catch (err) {
        toastError(err.message || "Impossible de révoquer cette invitation.");
        revokeBtn.disabled = false;
      }
    }
  });
}


/** Cible du rapport « Fiches » (agent consulté, période). */
export function setAgentReportTarget(userId, userName, period = "all") {
  agentReportUserId = userId;
  agentReportUserName = userName;
  agentReportPeriod = period;
}

/**
 * Ouvre le panneau admin ET charge son contenu. Point d'entrée unique :
 * l'onglet « Profil » l'ouvrait sans charger la liste des comptes (liste vide).
 */
export async function openAgentsModal() {
  document.getElementById("agentsModal").style.display = "block";
  renderErrorsPanel();
  closeControls();
  await refreshAgentsList();
  renderCitiesList();
  renderInvitesList();
}
