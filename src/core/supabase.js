import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    throw new Error("Supabase non configuré. Vérifiez votre fichier .env");
  }
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
  return client;
}

export async function getSession() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

/**
 * Inscription en libre-service (agent terrain). full_name est transmis en
 * métadonnées auth — un trigger Postgres côté Supabase (voir schema.sql,
 * handle_new_user_role()) crée automatiquement la ligne user_roles
 * correspondante avec role=NULL (en attente de validation par un admin) et
 * lui affecte un numéro d'agent. Rien de tout cela n'est fait ici : ce
 * client ne peut pas écrire user_roles (RLS réservée à service_role),
 * précisément pour qu'un agent ne puisse jamais s'auto-attribuer un rôle.
 *
 * @returns {Promise<{session: object|null, user: object|null}>} session
 * est null si le projet Supabase exige une confirmation par e-mail avant
 * de délivrer une session.
 */
export async function signUp(email, password, fullName) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
  if (error) throw error;
  return { session: data.session, user: data.user };
}

export async function signOut() {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
  client = null;
}

export function onAuthStateChange(callback) {
  const supabase = getSupabaseClient();
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
