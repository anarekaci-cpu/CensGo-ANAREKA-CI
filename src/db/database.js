import Dexie from "dexie";

export const db = new Dexie("ANAREKA_CensusDB");

// Schéma version 1
db.version(1).stores({
  // Points de recensement (données complètes)
  points: "++localId, id, block, [block+order], name, status, visited, lat, lon, syncedAt",

  // File d'attente de sync (modifications offline)
  syncQueue: "++id, pointId, action, createdAt, attempts, status",

  // Métadonnées de l'application
  meta: "key"
});

// === API haut niveau ===

export async function savePoints(pointsArray) {
  await db.points.clear();
  const withLocal = pointsArray.map((p, i) => ({
    ...p,
    localId: i + 1,
    syncedAt: new Date().toISOString()
  }));
  await db.points.bulkAdd(withLocal);
  return withLocal.length;
}

export async function getAllPoints() {
  return await db.points.toArray();
}

export async function getPointsByFilter(filters) {
  let collection = db.points;

  if (filters.block && filters.block !== "all") {
    collection = collection.where("block").equals(filters.block);
  }

  let results = await collection.toArray();

  if (filters.status && filters.status !== "all") {
    results = results.filter(p => p.status === filters.status);
  }

  if (filters.visited && filters.visited !== "all") {
    const wantVisited = filters.visited === "yes";
    results = results.filter(p => !!p.visited === wantVisited);
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.quartier && p.quartier.toLowerCase().includes(q)) ||
      (p.address && p.address.toLowerCase().includes(q))
    );
  }

  return results;
}

export async function updatePointVisit(pointId, visited, status) {
  const point = await db.points.where("id").equals(pointId).first();
  if (!point) return null;

  const updated = {
    ...point,
    visited,
    status: status || point.status,
    updatedAt: new Date().toISOString()
  };

  await db.points.put(updated);

  // Ajouter à la file de sync
  await db.syncQueue.add({
    pointId,
    action: "update_visit",
    payload: { visited, status },
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending"
  });

  return updated;
}

export async function getPendingSyncs() {
  return await db.syncQueue.where("status").equals("pending").toArray();
}

export async function markSyncDone(queueId) {
  await db.syncQueue.delete(queueId);
}

export async function markSyncFailed(queueId, errorMsg) {
  const item = await db.syncQueue.get(queueId);
  await db.syncQueue.update(queueId, {
    status: "failed",
    error: errorMsg,
    attempts: (item?.attempts || 0) + 1
  });
}

export async function getMeta(key) {
  const row = await db.meta.where("key").equals(key).first();
  return row ? row.value : null;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

export async function getStats() {
  const all = await db.points.toArray();
  const total = all.length;
  const visited = all.filter(p => p.visited).length;
  return { total, visited, remaining: total - visited };
}

export async function resetAllVisits() {
  await db.points.toCollection().modify(p => {
    p.visited = false;
    p.status = p.status || "NON DEFINI";
  });
  await db.syncQueue.clear();
}
