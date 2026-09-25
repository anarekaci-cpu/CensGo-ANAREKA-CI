import { getSupabaseClient } from "./supabase.js";

/**
 * Villes gérées par l'admin uniquement (voir supabase/add_cities.sql).
 * Liste fermée : contrairement à "quartier" (texte libre), la ville doit
 * rester contrôlée pour éviter les variantes d'orthographe qui
 * fragmenteraient les statistiques et les filtres.
 */

const CACHE_KEY = "censgo.cities.v1";

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(c => c && typeof c.name === "string") : [];
  } catch {
    return [];
  }
}

function writeCache(cities) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cities)); } catch { /* quota / mode privé */ }
}

/**
 * Liste des villes. Mise en cache locale à chaque succès : hors connexion,
 * la dernière liste connue est réutilisée — sans elle, le champ "Ville"
 * (obligatoire) restait vide et aucune fiche ne pouvait être enregistrée
 * sur le terrain sans réseau.
 */
export async function loadCities() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("cities")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) throw error;
    const cities = data || [];
    writeCache(cities);
    return cities;
  } catch (err) {
    const cached = readCache();
    console.warn(`Villes indisponibles (${err.message}) — ${cached.length} ville(s) en cache local utilisée(s).`);
    return cached;
  }
}

/** Dernière liste connue (synchrone) — pour un affichage immédiat au démarrage. */
export function getCachedCities() {
  return readCache();
}

export async function addCity(name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Nom de ville requis");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("cities")
    .insert({ name: clean })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Cette ville existe déjà.");
    throw error;
  }
  return data;
}

export async function removeCity(id) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("cities").delete().eq("id", id);
  if (error) throw error;
}
