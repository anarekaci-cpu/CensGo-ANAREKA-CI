import { getSupabaseClient } from "./supabase.js";

/**
 * Villes gérées par l'admin uniquement (voir supabase/add_cities.sql).
 * Liste fermée : contrairement à "quartier" (texte libre), la ville doit
 * rester contrôlée pour éviter les variantes d'orthographe qui
 * fragmenteraient les statistiques et les filtres.
 */

export async function loadCities() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("cities")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Villes indisponibles (table pas encore créée ou hors-ligne) :", err.message);
    return [];
  }
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
