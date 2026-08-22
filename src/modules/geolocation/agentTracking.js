import maplibregl from "maplibre-gl";
import { getSupabaseClient } from "../../core/supabase.js";
import { store } from "../../core/store.js";
import { getMap } from "../map/map.js";
import { escapeHtml } from "../../core/utils.js";

let agentMarkers = new Map();
let pollInterval = null;
let lastReportedAt = 0;
const REPORT_INTERVAL_MS = 15000;

export async function reportPosition(pos) {
  const user = store.get("user");
  if (!user || !pos) return;

  const now = Date.now();
  if (now - lastReportedAt < REPORT_INTERVAL_MS) return;
  lastReportedAt = now;

  try {
    const supabase = getSupabaseClient();
    await supabase.from("agent_positions").upsert({
      user_id: user.id,
      email: user.email,
      lat: pos.lat,
      lon: pos.lng,
      accuracy: pos.accuracy,
      heading: pos.heading,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  } catch (err) {
    console.warn("Erreur envoi position agent:", err.message);
  }
}

export async function loadAgentPositions() {
  const user = store.get("user");
  if (!user) return [];

  try {
    const supabase = getSupabaseClient();
    // Colonnes explicites (pas de select *) : la table ne contient que ces
    // champs, et on évite de télécharger d'éventuelles colonnes futures.
    const { data, error } = await supabase
      .from("agent_positions")
      .select("user_id,email,lat,lon,accuracy,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Chargement positions agents échoué:", err.message);
    return [];
  }
}

export function renderAgentMarkers(agents) {
  const map = getMap();
  if (!map) return;

  agentMarkers.forEach(entry => entry.marker.remove());
  agentMarkers.clear();

  agents.forEach(agent => {
    const now = Date.now();
    const agentTime = new Date(agent.updated_at).getTime();
    const ageMinutes = Math.round((now - agentTime) / 60000);
    const isStale = ageMinutes > 10;

    const el = document.createElement("div");
    el.style.cssText = `
      width:32px; height:32px; border-radius:50%;
      background:${isStale ? "#95a5a6" : "#3498db"};
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      display:flex; align-items:center; justify-content:center;
      font-size:16px; color:white; font-weight:700;
      cursor:pointer;
    `;
    el.textContent = "👤";

    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([agent.lon, agent.lat])
      .addTo(map);

    const popup = new maplibregl.Popup({ offset: [0, -20], closeButton: true })
      .setLngLat([agent.lon, agent.lat]);
    // escapeHtml : l'email provient de la base — ne jamais l'injecter brut.
    popup.setHTML(`
      <div style="min-width:150px">
        <b>👤 ${escapeHtml(agent.email)}</b><br>
        <span style="font-size:12px; color:#666">
          Position: ${agent.lat.toFixed(5)}, ${agent.lon.toFixed(5)}<br>
          ${isStale ? `⚠️ Inactif depuis ${ageMinutes} min` : `✅ Actif (${ageMinutes} min)`}
          ${agent.accuracy ? `<br>Précision: ${Math.round(agent.accuracy)}m` : ""}
        </span>
      </div>
    `);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.addTo(map);
    });

    agentMarkers.set(agent.user_id, { marker, popup });
  });
}

export async function refreshAgentMarkers() {
  const agents = await loadAgentPositions();
  renderAgentMarkers(agents);
  return agents;
}

export function startAgentTracking() {
  refreshAgentMarkers();
  pollInterval = setInterval(refreshAgentMarkers, 30000);
}

export function stopAgentTracking() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  agentMarkers.forEach(entry => entry.marker.remove());
  agentMarkers.clear();
}
