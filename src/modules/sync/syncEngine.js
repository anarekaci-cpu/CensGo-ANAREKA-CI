import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getPendingSyncs, markSyncDone, markSyncFailed, markPointSynced, getDeadSyncs, retryDeadSyncs } from "../../db/database.js";

let isOnline = navigator.onLine;
let isSyncing = false;
const MAX_CONCURRENT = 3;
// Timeout par opération : sans lui, une requête suspendue (réseau mobile)
// bloquait la file entière indéfiniment — les fiches restaient "en attente"
// sans jamais réussir ni échouer.
const OP_TIMEOUT_MS = 15000;

export async function initSyncEngine() {
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

  if (isOnline) await triggerSync();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Déduplique la file de sync : si plusieurs entrées "update_visit" existent
 * pour le même pointId, ne garder que la plus récente (la dernière valeur
 * de visited est toujours la bonne). Les "upsert_point" ne sont jamais
 * dédupliqués car chacun contient des données différentes.
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

  return [...latestByPoint.values(), ...upserts];
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

async function syncOne(supabase, item) {
  if (item.action === "update_visit") {
    const { error } = await withTimeout((signal) =>
      supabase
        .from(CONFIG.TABLE_NAME)
        .update({
          visited: item.payload.visited,
          status: item.payload.status,
          updated_at: new Date().toISOString()
        })
        .eq("point_id", item.pointId)
        .abortSignal(signal)
    );
    if (error) throw error;
  } else if (item.action === "upsert_point") {
    const p = item.payload;
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
  if (isSyncing) return;
  if (!store.get("user")) return; // pas d'envoi anonyme : RLS refuserait tout

  const pending = await getPendingSyncs();
  store.set("sync.pendingPointIds", [...new Set(pending.map(p => p.pointId))]);
  if (pending.length === 0) return;

  isSyncing = true;
  store.set("sync.status", "syncing");
  store.set("sync.pendingCount", pending.length);

  try {
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

