import L from "leaflet";
import { getSupabaseClient } from "../../core/supabase.js";
import { store } from "../../core/store.js";
import { getMap, flyToPoint } from "../map/map.js";

let agentMarkers = new Map();
let pollInterval = null;
let lastReportedAt = 0;
const REPORT_INTERVAL_MS = 15000;

/**
 * Envoie la position de l'agent connecté à Supabase (upsert).
 * Appelé automatiquement quand la géolocalisation se met à jour — throttlé
 * car watchPosition peut déclencher plusieurs fois par seconde, ce qui
 * enverrait sinon une requête réseau en continu (coût data/batterie terrain).
 */
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

/**
 * Charge toutes les positions d'agents et les affiche sur la carte.
 * Utilisé par les comptes admin pour suivre les agents terrain.
 */
export async function loadAgentPositions() {
  const user = store.get("user");
  if (!user) return [];

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("agent_positions")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Chargement positions agents échoué:", err.message);
    return [];
  }
}

/**
 * Affiche les marqueurs d'agents sur la carte.
 */
export function renderAgentMarkers(agents) {
  const map = getMap();
  if (!map) return;

  agentMarkers.forEach(m => map.removeLayer(m));
  agentMarkers.clear();

  agents.forEach(agent => {
    const now = Date.now();
    const agentTime = new Date(agent.updated_at).getTime();
    const ageMinutes = Math.round((now - agentTime) / 60000);
    const isStale = ageMinutes > 10;

    const icon = L.divIcon({
      className: "agent-marker",
      html: `<div style="
        width:32px; height:32px; border-radius:50%;
        background:${isStale ? "#95a5a6" : "#3498db"};
        border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex; align-items:center; justify-content:center;
        font-size:16px; color:white; font-weight:700;
      ">👤</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([agent.lat, agent.lon], { icon })
      .addTo(map)
      .bindPopup(`
        <div style="min-width:150px">
          <b>👤 ${agent.email}</b><br>
          <span style="font-size:12px; color:#666">
            Position: ${agent.lat.toFixed(5)}, ${agent.lon.toFixed(5)}<br>
            ${isStale ? `⚠️ Inactif depuis ${ageMinutes} min` : `✅ Actif (${ageMinutes} min)`}
            ${agent.accuracy ? `<br>Précision: ${Math.round(agent.accuracy)}m` : ""}
          </span>
        </div>
      `);

    agentMarkers.set(agent.user_id, marker);
  });
}

/**
 * Charge et affiche les positions des agents (appel admin).
 */
export async function refreshAgentMarkers() {
  const agents = await loadAgentPositions();
  renderAgentMarkers(agents);
  return agents;
}

/**
 * Démarre le polling des positions agents (toutes les 30 secondes).
 */
export function startAgentTracking() {
  refreshAgentMarkers();
  pollInterval = setInterval(refreshAgentMarkers, 30000);
}

/**
 * Arrête le polling.
 */
export function stopAgentTracking() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  agentMarkers.forEach(m => {
    const map = getMap();
    if (map) map.removeLayer(m);
  });
  agentMarkers.clear();
}

/**
 * Centre la carte sur un agent spécifique.
 */
export function focusAgent(userId) {
  const marker = agentMarkers.get(userId);
  if (marker) {
    const { lat, lng } = marker.getLatLng();
    flyToPoint(lat, lng, 17);
    marker.openPopup();
  }
}
