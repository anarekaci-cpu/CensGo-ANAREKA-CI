import { getSupabaseClient } from "./supabase.js";

/**
 * Photos de recensement (bucket privé "census-photos", voir
 * supabase/add_census_photos.sql) : jamais d'URL publique permanente,
 * seulement des URL signées à la demande — cohérent avec la posture
 * vie-privée déjà appliquée aux autres données personnelles du projet.
 */

const SIGNED_URL_EXPIRES_IN_SECONDS = 300; // 5 min : largement assez pour une consultation ponctuelle

/**
 * @param {string} photoPath chemin Storage (census_points.photo_path)
 * @returns {Promise<string|null>} URL signée temporaire, ou null si indisponible
 */
export async function getSignedPhotoUrl(photoPath) {
  if (!photoPath) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from("census-photos")
      .createSignedUrl(photoPath, SIGNED_URL_EXPIRES_IN_SECONDS);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (err) {
    console.warn("Photo indisponible :", err?.message || err);
    return null;
  }
}
