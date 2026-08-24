import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getPendingSyncs, markSyncDone, markSyncFailed, markPointSynced, getDeadSyncs, retryDeadSyncs, recordSyncConflict, getSyncConflicts, dismissSyncConflict } from "../../db/database.js";

let isOnline = navigator.onLine;
let isSyncing = false;
const MAX_CONCURRENT = 3;
// Timeout par opération : sans lui, une requête suspendue (réseau mobile)
// bloquait la file entière indéfiniment — les fiches restaient "en attente"
// sans jamais réussir ni échouer.
const OP_TIMEOUT_MS = 15000;

export async function initSyncEngine() {
  store.set("sync.conflicts", await getSyncConflicts());

  window.addEventListener("online", () => {
    isOnline = true;
    store.set("sync.status", "idle");
    triggerSync();
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    store.set("sync.status", "offline");
  });

  setInterval(() => {
    if (isOnline) triggerSync();
  }, CONFIG.SYNC_INTERVAL_MS);

  // Retour au premier plan (agent qui rouvre l'app après l'avoir mise en
  // arrière-plan, ou juste reverrouillé son téléphone) : ne pas attendre
  // jusqu'à SYNC_INTERVAL_MS (30s) pour pousser les fiches en attente —
  // triggerSync() est déjà protégé contre les appels concurrents (isSyncing)
  // donc ce déclenchement supplémentaire est sans risque.
  //
  // NB : ce n'est PAS l'API Background Sync (qui réveillerait un service
  // worker même app fermée) — celle-ci demanderait de réécrire le service
  // worker généré par vite-plugin-pwa (mode generateSW/Workbox) en mode
  // injectManifest avec un handler d'événement "sync" custom, un
  // changement plus risqué qu'on ne peut pas valider dans cet
  // environnement sans appareil réel. Ceci couvre le cas dominant en
  // pratique (app remise au premier plan) avec un risque quasi nul.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isOnline) {
        triggerSync();
      }
    });
  }

  // PAS de await ici : triggerSync() envoie la file d'attente vers Supabase
  // (potentiellement plusieurs items, timeouts et retries) et n'a AUCUN
  // rapport avec l'affichage des points (cache-first via IndexedDB, voir
  // dataLoader.js) ni avec la carte. Avant ce correctif, le premier écran
  // utile de l'app attendait la fin de CETTE synchro réseau avant de
  // s'afficher — potentiellement plusieurs secondes sur un réseau terrain
  // dégradé — alors que rien à l'écran n'en dépendait. La sync continue de
  // se dérouler normalement en arrière-plan et met à jour sync.status/
  // sync.pendingCount comme avant.
  if (isOnline) triggerSync();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Déduplique la file de sync : si plusieurs entrées "update_visit" existent
 * pour le même pointId, ne garder que la plus récente (la dernière valeur
 * de visited est toujours la bonne). Les "upsert_point" ne sont jamais
 * dédupliqués car chacun contient des données différentes.
 *
 * L'ordre chronologique global (createdAt) est préservé entre les deux
 * types d'action : traiter systématiquement tous les "update_visit" avant
 * tous les "upsert_point" (peu importe leur date réelle) pouvait envoyer un
 * update_visit plus RÉCENT avant un upsert_point plus ANCIEN sur le même
 * point — le worker suivant écrasait alors le "visited" fraîchement mis à
 * jour avec la valeur, obsolète, portée par l'upsert. Scénario concret :
 * agent modifie une fiche (upsert_point, visited:false) puis tape aussitôt
 * "Marquer visité" (update_visit, visited:true, postérieur) — sans tri par
 * date, le serveur recevait l'update_visit après l'upsert_point qui le
 * suit dans la file et revenait silencieusement à visited:false.
 */
export function dedupSyncQueue(items) {
  const latestByPoint = new Map();
  const upserts = [];

  for (const item of items) {
    if (item.action === "update_visit") {
      const existing = latestByPoint.get(item.pointId);
      if (!existing || item.createdAt > existing.createdAt) {
        if (existing) latestByPoint.delete(item.pointId);
        latestByPoint.set(item.pointId, item);
      }
    } else {
      upserts.push(item);
    }
  }

  return [...latestByPoint.values(), ...upserts].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
}

/** AbortController avec timeout — évite les sockets suspendus infinis. */
async function withTimeout(promiseBuilder) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OP_TIMEOUT_MS);
  try {
    return await promiseBuilder(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Enregistre le conflit et "résout" la file d'attente pour cet item :
 * pas de retry infini sur un conflit qui ne se résoudra jamais tout seul,
 * et markPointSynced() lève l'exclusion du point des futurs rechargements
 * Supabase (voir savePoints()/unsyncedIds, database.js) — sans ça le point
 * resterait exclu indéfiniment, jamais rafraîchi depuis le serveur. Le
 * payload local est conservé dans le conflit pour permettre une révision
 * manuelle plutôt qu'une perte silencieuse.
 */
async function handleConflict(item) {
  await recordSyncConflict({
    pointId: item.pointId,
    action: item.action,
    localPayload: item.payload,
    detectedAt: new Date().toISOString()
  });
  await markPointSynced(item.pointId);
  await markSyncDone(item.id);
}

async function syncOne(supabase, item) {
  if (item.action === "update_visit") {
    // Contrôle serveur anti-fraude (audit sécu) : le contrôle de proximité
    // GPS (canMarkVisited(), core/geofence.js) n'existait qu'en JS côté
    // client — un appel direct à l'API (hors app) pouvait le contourner
    // totalement. assert_visit_geofence() (schema.sql) valide à partir des
    // coordonnées capturées par l'app au moment de l'action (voir
    // database.js: updatePointVisit()) et lève une exception si trop loin ;
    // ne fait rien de plus (ni update ni lecture) — la logique de mise à
    // jour conditionnelle ci-dessous, avec sa détection de conflit, reste
    // inchangée. Uniquement au passage à visited=true : décocher n'a jamais
    // été soumis au contrôle anti-fraude (voir toggleVisit()).
    if (item.payload.visited) {
      const { error: geofenceError } = await withTimeout((signal) =>
        supabase.rpc("assert_visit_geofence", {
          p_point_id: item.pointId,
          p_lat: item.payload.lat,
          p_lon: item.payload.lon
        }).abortSignal(signal)
      );
      if (geofenceError) throw geofenceError;
    }

    let query = supabase
      .from(CONFIG.TABLE_NAME)
      .update({
        visited: item.payload.visited,
        status: item.payload.status,
        updated_at: new Date().toISOString()
      })
      .eq("point_id", item.pointId);

    // Écriture CONDITIONNELLE quand on connaît le updated_at serveur au
    // moment de l'édition locale (baseUpdatedAt) : si un autre agent a
    // modifié ce point depuis, la condition ne correspond à aucune ligne
    // -> conflit détecté au lieu d'écraser silencieusement son changement
    // (last-write-wins). NB : une ligne bloquée par une policy RLS produit
    // le même résultat "0 ligne" — voir handleConflict, le libellé côté UI
    // reste volontairement prudent ("ne semble pas avoir été appliquée")
    // plutôt que d'affirmer à tort une édition concurrente.
    if (item.baseUpdatedAt) {
      query = query.eq("updated_at", item.baseUpdatedAt);
    }

    const { data, error } = await withTimeout((signal) => query.select("point_id").abortSignal(signal));
    if (error) throw error;

    if (item.baseUpdatedAt && (!data || data.length === 0)) {
      await handleConflict(item);
      return;
    }
  } else if (item.action === "upsert_point") {
    const p = item.payload;

    // upsert() ne permet pas de filtre conditionnel côté Supabase — on
    // vérifie donc l'état serveur par une lecture préalable. Best-effort :
    // une lecture échouée ne bloque PAS l'écriture (mieux vaut risquer un
    // écrasement que perdre une fiche entière pour un souci réseau
    // ponctuel sur cette seule vérification).
    if (item.baseUpdatedAt) {
      try {
        const { data: serverRow } = await withTimeout((signal) =>
          supabase.from(CONFIG.TABLE_NAME).select("updated_at").eq("point_id", p.id).abortSignal(signal).maybeSingle()
        );
        if (serverRow?.updated_at && serverRow.updated_at !== item.baseUpdatedAt) {
          await handleConflict(item);
          return;
        }
      } catch {
        // Vérification indisponible — on procède à l'upsert normal.
      }
    }

    const user = store.get("user");
    const { error } = await withTimeout((signal) =>
      supabase
        .from(CONFIG.TABLE_NAME)
        .upsert({
          point_id: p.id,
          block: p.block,
          order: p.order,
          name: p.name,
          tel: p.tel,
          etablissement: p.etablissement,
          activity_type: p.activityType,
          quartier: p.quartier,
          address: p.address,
          produits: p.produits,
          sexe: p.sexe,
          status: p.status,
          visited: p.visited,
          lat: p.lat,
          lon: p.lon,
          created_by: user?.id || null,
          updated_at: new Date().toISOString()
        }, { onConflict: "point_id" })
        .abortSignal(signal)
    );
    if (error) throw error;
  }
  // Idempotence : une opération n'est retirée de la file QUE si le serveur
  // l'a acceptée (pas d'erreur ci-dessus). markSyncDone ne s'exécute jamais
  // après un échec — la donnée locale ET l'entrée pending sont conservées.
  await markPointSynced(item.pointId);
  await markSyncDone(item.id);
}

async function syncWithConcurrency(items, supabase) {
  const queue = [...items];
  const run = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      let attempts = 0;
      while (attempts < 3) {
        try {
          await syncOne(supabase, item);
          break;
        } catch (err) {
          attempts++;
          if (attempts >= 3) {
            console.error(`Sync failed after 3 attempts for ${item.pointId}:`, err);
            await markSyncFailed(item.id, err.message, CONFIG.MAX_RETRY_ATTEMPTS);
          } else {
            await sleep(500 * Math.pow(2, attempts - 1));
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, () => run()));
}

export async function triggerSync() {
  // Garde de ré-entrance (#28) : l'intervalle 30s, l'événement "online" et
  // les retries manuels pouvaient lancer des syncs CONCURRENTES sur la même
  // file — double envoi, compteurs incohérents. Une seule sync à la fois ;
  // les appels concurrents attendent simplement le prochain tick.
  //
  // BUG corrigé (audit) : `isSyncing = true` était posé APRÈS le premier
  // `await` (getPendingSyncs()) — la garde était donc "vérifier puis agir"
  // avec un point de suspension entre les deux, la fenêtre classique d'une
  // race condition. Deux appels quasi simultanés (ex: le déclenchement de
  // boot ET le "visibilitychange" au premier plan, tous deux vrais à
  // l'ouverture de l'app en ligne) passaient TOUS LES DEUX le test avant que
  // l'un ou l'autre ne pose le flag, et traitaient alors la même file en
  // parallèle — pour un "update_visit", la seconde exécution retrouvait un
  // `updated_at` déjà changé par la première et déclenchait un FAUX conflit
  // de sync (handleConflict), signalé à tort à l'agent. Poser le flag ICI,
  // avant tout `await`, ferme la fenêtre.
  if (isSyncing) return;
  if (!store.get("user")) return; // pas d'envoi anonyme : RLS refuserait tout
  isSyncing = true;

  try {
    const pending = await getPendingSyncs();
    store.set("sync.pendingPointIds", [...new Set(pending.map(p => p.pointId))]);
    if (pending.length === 0) {
      const dead = await getDeadSyncs();
      store.set("sync.pendingCount", 0);
      store.set("sync.deadCount", dead.length);
      store.set("sync.status", dead.length > 0 ? "error" : "idle");
      store.set("sync.conflicts", await getSyncConflicts());
      return;
    }

    store.set("sync.status", "syncing");
    store.set("sync.pendingCount", pending.length);

    const supabase = getSupabaseClient();
    const deduped = dedupSyncQueue(pending);
    await syncWithConcurrency(deduped, supabase);

    const remaining = await getPendingSyncs();
    const dead = await getDeadSyncs();
    store.set("sync.pendingCount", remaining.length);
    store.set("sync.pendingPointIds", [...new Set(remaining.map(p => p.pointId))]);
    store.set("sync.deadCount", dead.length);
    store.set("sync.status", dead.length > 0 ? "error" : (remaining.length > 0 ? "syncing" : "idle"));
    store.set("sync.lastSync", new Date().toISOString());
    store.set("sync.conflicts", await getSyncConflicts());
  } catch (err) {
    store.set("sync.status", "error");
    console.error("Sync engine error:", err);
  } finally {
    isSyncing = false;
  }
}

export async function retryFailedSyncs() {
  const count = await retryDeadSyncs();
  if (count > 0 && isOnline) await triggerSync();
  return count;
}

export async function dismissConflict(pointId) {
  await dismissSyncConflict(pointId);
  store.set("sync.conflicts", await getSyncConflicts());
}

