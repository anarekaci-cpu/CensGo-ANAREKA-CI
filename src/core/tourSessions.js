import { getSupabaseClient } from "./supabase.js";

/**
 * Historique des tournées optimisées terminées (voir
 * supabase/add_tour_sessions.sql) — sert d'approximation des kilomètres
 * parcourus par agent dans le rapport de paie (modules/report/agentReport.js).
 * Un agent ne lit que ses propres sessions ; un admin les lit toutes (RLS).
 */
export async function loadTourSessions() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("tour_sessions")
      .select("id, user_id, distance_km, stop_count, started_at, ended_at")
      .order("started_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      userId: row.user_id,
      distanceKm: row.distance_km,
      stopCount: row.stop_count,
      startedAt: row.started_at,
      endedAt: row.ended_at
    }));
  } catch (err) {
    console.warn("Historique des tournées indisponible (table pas encore créée ou hors-ligne) :", err.message);
    return [];
  }
}
