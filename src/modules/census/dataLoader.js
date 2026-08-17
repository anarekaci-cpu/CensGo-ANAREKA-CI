import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { savePoints, getAllPoints, setMeta } from "../../db/database.js";

export async function loadCensusData() {
  store.set("ui.loading", true);
  store.set("sync.status", "syncing");

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(CONFIG.TABLE_NAME)
      .select("*")
      .order("block", { ascending: true })
      .order("order", { ascending: true });

    if (error) throw error;

    if (data && data.length > 0) {
      const formatted = data.map(row => ({
        id: row.point_id,
        block: row.block,
        order: row.order,
        name: row.name,
        tel: row.tel,
        quartier: row.quartier,
        address: row.address,
        produits: row.produits,
        sexe: row.sexe,
        status: row.status || "NON DEFINI",
        visited: row.visited === true || row.visited === "true" || row.visited === "oui",
        lat: row.lat,
        lon: row.lon
      }));

      await savePoints(formatted);
      await setMeta("lastSync", new Date().toISOString());
      store.set("points", formatted);
      store.set("sync.status", "idle");
      store.set("sync.lastSync", new Date().toISOString());

      console.log(`📥 ${formatted.length} points chargés depuis Supabase`);
      return formatted;
    }
  } catch (err) {
    console.warn("⚠️ Supabase indisponible, chargement depuis IndexedDB:", err.message);
  }

  const localPoints = await getAllPoints();
  if (localPoints.length > 0) {
    store.set("points", localPoints);
    store.set("sync.status", "offline");
    console.log(`📦 ${localPoints.length} points chargés depuis IndexedDB`);
    return localPoints;
  }

  store.set("sync.status", "error");
  store.set("ui.error", "Aucune donnée disponible. Vérifiez votre connexion.");
  return [];
}
