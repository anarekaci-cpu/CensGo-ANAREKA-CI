import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { savePoints, getAllPoints, setMeta } from "../../db/database.js";

// Traduit une erreur Supabase/PostgREST en message actionnable pour un
// agent terrain. Sans ça, une policy RLS bloquante ou une table vide
// produisait le même écran "Aucun point" — impossible à diagnostiquer.
function describeSyncError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err);
  if (code === "42501" || /row-level security/i.test(msg)) {
    return "Accès refusé par la base (RLS). Contactez l'administrateur : les règles d'accès bloquent la lecture des points.";
  }
  if (code === "42P01") {
    return `Table "${CONFIG.TABLE_NAME}" introuvable sur le serveur. Le schéma Supabase n'a pas été initialisé.`;
  }
  if (code === "42703") {
    return `Colonne manquante dans "${CONFIG.TABLE_NAME}" : ${msg}. Le schéma du projet ne correspond pas à l'application.`;
  }
  if (/JWT|api ?key|Invalid API key/i.test(msg)) {
    return "Clé API Supabase invalide ou expirée. Vérifiez VITE_SUPABASE_ANON_KEY.";
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return "Serveur Supabase injoignable. Vérifiez la connexion internet.";
  }
  return msg;
}

/**
 * Charge les données de recensement depuis Supabase (en ligne) ou IndexedDB (offline).
 * @param {boolean} forceOffline - Si true, saute l'appel Supabase et charge depuis IndexedDB.
 */
export async function loadCensusData(forceOffline = false) {
  store.set("ui.loading", true);
  store.set("sync.status", "syncing");

  let remoteError = null;

  if (!forceOffline) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from(CONFIG.TABLE_NAME)
        .select("*")
        .order("block", { ascending: true })
        .order("order", { ascending: true });

      if (error) throw error;

      // CAS CRITIQUE : requête OK mais 0 ligne. Avant ce correctif, ce cas
      // tombait silencieusement au fallback local sans aucun log — un agent
      // voyait "Aucun point" sans jamais savoir si c'était normal.
      // On journalise visiblement pour distinguer "base vide" d'une panne.
      if (!data || data.length === 0) {
        console.warn(
          `[DATA] Requête Supabase OK mais 0 ligne dans "${CONFIG.TABLE_NAME}". ` +
          "Causes possibles : (1) policies RLS SELECT absentes/restrictives, " +
          "(2) table réellement vide, (3) mauvais projet Supabase."
        );
        store.set("sync.warning",
          "Le serveur a répondu mais n'a renvoyé AUCUN point. " +
          "Si des points existent dans le dashboard Supabase, " +
          "les règles d'accès (RLS) bloquent la lecture."
        );
      } else {
        const formatted = data.map(row => ({
          id: row.point_id,
          block: row.block,
          order: row.order,
          name: row.name,
          tel: row.tel,
          etablissement: row.etablissement || "",
          activityType: row.activity_type || "",
          quartier: row.quartier,
          address: row.address,
          produits: row.produits,
          sexe: row.sexe,
          status: row.status || "NON DEFINI",
          visited: row.visited === true || row.visited === "true" || row.visited === "oui",
          lat: row.lat,
          lon: row.lon
        }));

        // savePoints() réconcilie l'état visited local vs serveur.
        // On lit ensuite depuis IndexedDB pour récupérer les valeurs réconciliées
        // (pas les valeurs brutes de Supabase qui pourraient ignorer l'intention locale).
        await savePoints(formatted);
        const merged = await getAllPoints();
        await setMeta("lastSync", new Date().toISOString());
        store.set("points", merged);
        store.set("sync.status", "idle");
        store.set("sync.lastSync", new Date().toISOString());
        store.set("sync.warning", null);

        console.log(`📥 ${merged.length} points chargés depuis Supabase`);
        return merged;
      }
    } catch (err) {
      // AVANT : simple console.warn qui avalait l'erreur → diagnostic impossible.
      // Maintenant : erreur explicite en console + exposée au store pour l'UI.
      remoteError = err;
      console.error("[DATA] Échec du chargement Supabase:", err);
      store.set("sync.errorDetail", describeSyncError(err));
    }
  }

  const localPoints = await getAllPoints();
  if (localPoints.length > 0) {
    store.set("points", localPoints);
    store.set("sync.status", "offline");
    console.log(`📦 ${localPoints.length} points chargés depuis IndexedDB`);
    return localPoints;
  }

  store.set("sync.status", "error");
  const detail = remoteError ? describeSyncError(remoteError) : null;
  store.set("ui.error", detail
    ? `Aucune donnée disponible. ${detail}`
    : "Aucune donnée disponible. Vérifiez votre connexion.");
  return [];
}
