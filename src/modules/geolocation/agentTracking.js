import * as maplibregl from "maplibre-gl";
import { getSupabaseClient } from "../../core/supabase.js";
import { store } from "../../core/store.js";
import { getMap } from "../map/map.js";

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

  // popup.remove() en plus de marker.remove() : le popup est ouvert
  // séparément (au clic, popup.addTo(map)) plutôt que via marker.setPopup(),
  // donc retirer le marqueur ne fermait pas un popup resté ouvert — il
  // restait affiché indéfiniment sur la carte avec une position/ancienneté
  // périmée à chaque rafraîchissement (toutes les 30s).
  agentMarkers.forEach(entry => {
    entry.marker.remove();
    entry.popup.remove();
  });
  agentMarkers.clear();

  agents.forEach(agent => {
    try {
      const lat = Number(agent?.lat);
      const lon = Number(agent?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const now = Date.now();
      const agentTime = new Date(agent.updated_at).getTime();
      const ageMinutes = Math.round((now - agentTime) / 60000);
      const isStale = ageMinutes > 10;

      // Halo + pastille (même langage visuel que le marqueur "vous êtes ici",
      // voir style.css .user-location-*). Le halo pulse seulement si actif.
      const el = document.createElement("div");
      el.className = `agent-marker-dot${isStale ? " is-stale" : ""}`;
      const halo = document.createElement("div");
      halo.className = "agent-marker-halo";
      const core = document.createElement("div");
      core.className = "agent-marker-core";
      core.textContent = "👤";
      el.append(halo, core);

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lon, lat])
        .addTo(map);

      // Popup construit en DOM + textContent : l'email provient de la base,
      // jamais interprété comme HTML.
      const content = document.createElement("div");
      content.style.minWidth = "150px";
      const title = document.createElement("b");
      title.textContent = `👤 ${agent.email ?? ""}`;
      const info = document.createElement("span");
      info.style.cssText = "font-size:12px; color:#666";
      const lines = [
        `Position: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        isStale ? `⚠️ Inactif depuis ${ageMinutes} min` : `✅ Actif (${ageMinutes} min)`
      ];
      if (agent.accuracy) lines.push(`Précision: ${Math.round(agent.accuracy)}m`);
      lines.forEach((line, i) => {
        if (i > 0) info.appendChild(document.createElement("br"));
        info.appendChild(document.createTextNode(line));
      });
      content.append(title, document.createElement("br"), info);

      const popup = new maplibregl.Popup({ offset: [0, -20], closeButton: true })
        .setLngLat([lon, lat])
        .setDOMContent(content);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        popup.addTo(map);
      });

      agentMarkers.set(agent.user_id, { marker, popup });
    } catch (err) {
      console.warn("Marqueur agent ignoré:", err?.message || err);
    }
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
  agentMarkers.forEach(entry => {
    entry.marker.remove();
    entry.popup.remove();
  });
  agentMarkers.clear();
}
