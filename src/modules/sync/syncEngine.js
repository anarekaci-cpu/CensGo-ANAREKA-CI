import { getSupabaseClient } from "../../core/supabase.js";
import { CONFIG } from "../../core/config.js";
import { store } from "../../core/store.js";
import { getPendingSyncs, markSyncDone, markSyncFailed } from "../../db/database.js";

let syncInterval = null;
let isOnline = navigator.onLine;

export async function initSyncEngine() {
  // Écouter l'état du réseau
  window.addEventListener("online", () => {
    isOnline = true;
    store.set("sync.status", "idle");
    triggerSync();
  });

  window.addEventListener("offline", () => {
    isOnline = false;
    store.set("sync.status", "offline");
  });

  // Sync périodique
  syncInterval = setInterval(() => {
    if (isOnline) triggerSync();
  }, CONFIG.SYNC_INTERVAL_MS);

  // Sync initiale
  if (isOnline) await triggerSync();
}

export async function triggerSync() {
  const pending = await getPendingSyncs();
  if (pending.length === 0) return;

  store.set("sync.status", "syncing");
  store.set("sync.pendingCount", pending.length);

  try {
    const supabase = getSupabaseClient();

    for (const item of pending) {
      try {
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
        }

        await markSyncDone(item.id);
      } catch (err) {
        console.error(`Sync failed for ${item.pointId}:`, err);
        await markSyncFailed(item.id, err.message);
      }
    }

    const remaining = await getPendingSyncs();
    store.set("sync.pendingCount", remaining.length);
    store.set("sync.status", remaining.length > 0 ? "error" : "idle");
    store.set("sync.lastSync", new Date().toISOString());

  } catch (err) {
    store.set("sync.status", "error");
    console.error("Sync engine error:", err);
  }
}

export function destroySyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
