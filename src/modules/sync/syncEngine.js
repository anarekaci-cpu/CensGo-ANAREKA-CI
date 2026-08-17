import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getPendingSyncs, markSyncDone, markSyncFailed, markPointSynced, getDeadSyncs, retryDeadSyncs } from "../../db/database.js";

let syncInterval = null;
let isOnline = navigator.onLine;
const MAX_CONCURRENT = 3;

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

  syncInterval = setInterval(() => {
    if (isOnline) triggerSync();
  }, CONFIG.SYNC_INTERVAL_MS);

  if (isOnline) await triggerSync();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function syncOne(supabase, item) {
  if (item.action === "update_visit") {
    const { error } = await supabase
      .from(CONFIG.TABLE_NAME)
      .update({
        visited: item.payload.visited,
        status: item.payload.status,
        updated_at: new Date().toISOString()
      })
      .eq("point_id", item.pointId);
    if (error) throw error;
  } else if (item.action === "upsert_point") {
    const p = item.payload;
    const { error } = await supabase
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
        updated_at: new Date().toISOString()
      }, { onConflict: "point_id" });
    if (error) throw error;
  }
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
  const pending = await getPendingSyncs();
  store.set("sync.pendingPointIds", [...new Set(pending.map(p => p.pointId))]);
  if (pending.length === 0) return;

  store.set("sync.status", "syncing");
  store.set("sync.pendingCount", pending.length);

  try {
    const supabase = getSupabaseClient();
    await syncWithConcurrency(pending, supabase);

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
  }
}

export async function retryFailedSyncs() {
  const count = await retryDeadSyncs();
  if (count > 0 && isOnline) await triggerSync();
  return count;
}

export function destroySyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
