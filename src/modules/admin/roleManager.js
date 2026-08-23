import { getSupabaseClient } from "../../core/supabase.js";

/**
 * Gestion des comptes agents DEPUIS L'APPLICATION — réservé aux admins
 * (voir schema.sql : policies "Admin can read all roles" / "Admin can
 * update roles"). Un compte fraîchement inscrit a role=NULL ("en attente")
 * tant qu'un admin ne l'a pas validé ici ou dans le dashboard Supabase.
 */

/**
 * @returns {Promise<Array<{user_id:string, role:string|null, full_name:string|null, agent_number:number|null}>>}
 */
export async function fetchAllRoles() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role, full_name, agent_number")
    .order("role", { ascending: true, nullsFirst: true })
    .order("agent_number", { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * @param {string} userId
 * @param {"agent"|"admin"|null} role
 */
export async function setUserRole(userId, role) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("user_roles")
    .update({ role })
    .eq("user_id", userId);
  if (error) throw error;
}
