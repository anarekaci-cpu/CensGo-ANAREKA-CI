import { getSupabaseClient } from "./supabase.js";

/**
 * Liens d'invitation admin (voir supabase/add_invites.sql) : un agent inscrit
 * via un lien valide est approuvé automatiquement, sans passer par l'écran
 * "en attente de validation". Toujours role='agent' — la promotion admin
 * reste un geste manuel (panneau "Comptes agents").
 */

export async function listInvites() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invites")
    .select("id, token, max_uses, uses, expires_at, revoked, label, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * @param {{label?:string, maxUses?:number|null, expiresInDays?:number|null}} opts
 */
export async function createInvite({ label = "", maxUses = 20, expiresInDays = 30 } = {}) {
  const supabase = getSupabaseClient();
  const expires_at = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null;
  const { data, error } = await supabase
    .from("invites")
    .insert({ label: label.trim() || null, max_uses: maxUses ?? null, expires_at })
    .select("id, token, max_uses, uses, expires_at, revoked, label, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function revokeInvite(id) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("invites").update({ revoked: true }).eq("id", id);
  if (error) throw error;
}

/**
 * Consomme un lien d'invitation pour le compte actuellement connecté.
 * Ne fait rien (silencieux) si le compte est déjà validé — voir la garde
 * "role IS NULL" côté serveur, redeem_invite() renvoie alors une erreur
 * explicite que cette fonction absorbe pour ne jamais bloquer une connexion
 * normale sur un vieux lien réutilisé par erreur.
 * @returns {Promise<boolean>} true si le rôle a été accordé
 */
export async function redeemInvite(token) {
  if (!token) return false;
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("redeem_invite", { p_token: token });
  if (error) {
    console.warn("Invitation non appliquée :", error.message);
    return false;
  }
  return true;
}

/** URL absolue partageable pour un token d'invitation donné. */
export function buildInviteUrl(token) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", token);
  return url.toString();
}
