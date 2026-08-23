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
 * user_roles ne stocke jamais l'e-mail (RLS n'expose pas auth.users au
 * client) — admin_list_accounts() (schema.sql) est une fonction serveur
 * SECURITY DEFINER qui fait la jointure et vérifie elle-même côté serveur
 * que l'appelant est admin.
 *
 * @returns {Promise<Array<{user_id:string, email:string|null, role:string|null, full_name:string|null, agent_number:number|null}>>}
 */
export async function fetchAllAccounts() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("admin_list_accounts");
  if (!error) return data || [];
  // La fonction n'existe pas encore côté serveur (schema.sql pas encore
  // réexécuté après cette mise à jour) : on dégrade vers la liste sans
  // e-mail plutôt que de casser tout le panneau "Comptes agents".
  const notFound = error.code === "PGRST202" || /admin_list_accounts/i.test(error.message || "");
  if (notFound) return fetchAllRoles();
  throw error;
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
