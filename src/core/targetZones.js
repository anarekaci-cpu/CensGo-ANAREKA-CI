import { getSupabaseClient } from "./supabase.js";

/**
 * Zones à couvrir définies par un admin/superviseur, indépendamment de tout
 * point déjà recensé — permet de dire "il faut couvrir tel quartier" avant
 * même qu'un agent n'y ait mis les pieds.
 */

export async function loadTargetZones() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("target_zones")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Zones cibles indisponibles (table pas encore créée ou hors-ligne) :", err.message);
    return [];
  }
}

export async function addTargetZone(name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Nom de zone requis");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("target_zones")
    .insert({ name: clean })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Cette zone existe déjà.");
    throw error;
  }
  return data;
}

export async function removeTargetZone(id) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("target_zones").delete().eq("id", id);
  if (error) throw error;
}
