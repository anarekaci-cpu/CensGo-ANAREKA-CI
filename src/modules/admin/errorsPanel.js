// Panneau admin « Erreurs terrain » : synthèse des erreurs JS remontées par
// les téléphones des agents (core/errorReporter.js → client_errors).
// Affiché uniquement si VITE_ENABLE_ERROR_REPORTING=true.
import { CONFIG } from "../../core/config.js";
import { getSupabaseClient } from "../../core/supabase.js";
import { escapeHtml } from "../../core/utils.js";

export function errorsSectionHtml() {
  if (!CONFIG.ENABLE_ERROR_REPORTING) return "";
  return `
    <div class="agents-cities-section" id="errorsSection">
      <h4>Erreurs terrain</h4>
      <p class="input-hint">Bugs rencontrés par les agents, regroupés par erreur. Les e-mails et numéros de téléphone sont masqués avant l'envoi.</p>
      <div id="errorsList" class="errors-list"><p class="input-hint">Chargement…</p></div>
    </div>`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export async function renderErrorsPanel() {
  const list = document.getElementById("errorsList");
  if (!list) return;
  try {
    const { data, error } = await getSupabaseClient()
      .from("client_errors_summary")
      .select("fingerprint,message,total,agents_touches,derniere_version,derniere_fois")
      .order("derniere_fois", { ascending: false })
      .limit(20);
    if (error) throw error;
    if (!data?.length) {
      list.innerHTML = `<p class="input-hint">Aucune erreur remontée. Tout va bien.</p>`;
      return;
    }
    list.innerHTML = data.map(e => `
      <div class="error-row">
        <div class="error-msg">${escapeHtml(e.message)}</div>
        <div class="error-meta">${escapeHtml(String(e.total))} fois · ${escapeHtml(String(e.agents_touches))} agent(s) · v${escapeHtml(e.derniere_version || "?")} · ${escapeHtml(formatDate(e.derniere_fois))}</div>
      </div>`).join("");
  } catch (err) {
    list.innerHTML = `<p class="input-hint">Impossible de charger les erreurs (${escapeHtml(err?.message || "erreur")}). Le script supabase/add_client_errors.sql a-t-il été exécuté ?</p>`;
  }
}
