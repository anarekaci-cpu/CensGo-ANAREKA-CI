import Dexie from "dexie";
import { CONFIG } from "../core/config.js";

export const db = new Dexie(CONFIG.DB_NAME);

// Schéma version 1
db.version(1).stores({
  // Points de recensement (données complètes)
  points: "++localId, id, block, [block+order], name, status, visited, lat, lon, syncedAt",

  // File d'attente de sync (modifications offline)
  syncQueue: "++id, pointId, action, createdAt, attempts, status",

  // Métadonnées de l'application
  meta: "key"
});

// Version 2 : ajouter l'index updatedAt pour permettre le tri par date de
// modification (utile pour "récemment visités", historique, etc.)
db.version(2).stores({
  points: "++localId, id, block, [block+order], name, status, visited, lat, lon, syncedAt, updatedAt"
});

// === API haut niveau ===

export async function savePoints(pointsArray) {
  // Préserver les points créés localement qui n'ont pas encore été synchronisés
  const localPoints = await db.points.toArray();
  const unsynced = localPoints.filter(p => !p.syncedAt);
  const unsyncedIds = new Set(unsynced.map(p => p.id));

  // Construire une Map de l'état visited local pour les points synchronisés :
  // si un agent a basculé un point en "non visité" localement et que la sync
  // n'a pas encore poussé ce changement vers Supabase, la valeur serveur
  // (visited: true) ne doit PAS écraser l'intention locale.
  const localVisitedState = new Map();
  for (const p of localPoints) {
    if (p.syncedAt) localVisitedState.set(p.id, !!p.visited);
  }

  await db.points.clear();

  const withLocal = pointsArray
    .filter(p => !unsyncedIds.has(p.id))
    .map((p, i) => {
      const localVisited = localVisitedState.get(p.id);
      // Si le point existait déjà en local ET que l'état local diffère du
      // serveur, préserver la valeur locale (l'agent a agi hors-ligne).
      // Si localVisited est undefined (premier chargement), utiliser la valeur serveur.
      const mergedVisited = localVisited !== undefined ? localVisited : p.visited;
      return {
        ...p,
        visited: mergedVisited,
        localId: i + 1,
        syncedAt: new Date().toISOString()
      };
    });

  let nextId = withLocal.length + 1;
  const unsyncedPreserved = unsynced.map(p => ({
    ...p,
    localId: nextId++
  }));

  await db.points.bulkAdd([...withLocal, ...unsyncedPreserved]);
  return withLocal.length + unsyncedPreserved.length;
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

export async function upsertPoint(pointData) {
  let point = await db.points.where("id").equals(pointData.id || "").first();
  const now = new Date().toISOString();
  let updated;
  let pendingSyncedFlag = false;
  if (point) {
    updated = {
      ...point,
      ...pointData,
      updatedAt: now
    };
    await db.points.put(updated);
  } else {
    const all = await db.points.toArray();
    const maxLocalId = all.reduce((max, p) => Math.max(max, p.localId || 0), 0);
    // Un ID basé sur un compteur local (ex: bgv_004) entrerait en collision dès que
    // deux agents créent un nouveau point hors-ligne au même moment : chaque téléphone
    // reparties du même maxLocalId, et le second à synchroniser écraserait le premier
    // via l'upsert Supabase (onConflict: point_id). Un UUID généré côté client garantit
    // l'unicité sans coordination entre appareils (standard ODK/KoboCollect).
    const newId = pointData.id || `arka_${crypto.randomUUID()}`;
    pendingSyncedFlag = true;
    updated = {
      order: maxLocalId + 1,
      block: 1,
      name: "",
      tel: "",
      etablissement: "",
      activityType: "",
      quartier: "",
      address: "",
      produits: "",
      sexe: "Homme",
      status: "VERT (Joignable)",
      visited: false,
      lat: CONFIG.MAP_CENTER[0],
      lon: CONFIG.MAP_CENTER[1],
      ...pointData,
      id: newId,
      localId: maxLocalId + 1,
      syncedAt: null,
      updatedAt: now
    };
    await db.points.add(updated);
  }

  await db.syncQueue.add({
    pointId: updated.id,
    action: "upsert_point",
    payload: updated,
    createdAt: now,
    attempts: 0,
    status: "pending"
  });

  return { ...updated, pendingSync: pendingSyncedFlag };
}

export async function markPointSynced(pointId) {
  const point = await db.points.where("id").equals(pointId).first();
  if (!point) return;
  await db.points.put({ ...point, syncedAt: new Date().toISOString() });
}

export async function getPendingSyncs() {
  return await db.syncQueue.where("status").equals("pending").toArray();
}

export async function markSyncDone(queueId) {
  await db.syncQueue.delete(queueId);
}

// Remet en file d'attente jusqu'à maxAttempts tentatives ; au-delà, marque l'item
// "dead" pour qu'il arrête d'être retenté silencieusement et remonte à l'utilisateur
// (avant ce correctif, un item passait direct en "failed" et n'était plus jamais
// repris par getPendingSyncs — la fiche restait bloquée sans que personne ne le sache).
export async function markSyncFailed(queueId, errorMsg, maxAttempts = 3) {
  const item = await db.syncQueue.get(queueId);
  const attempts = (item?.attempts || 0) + 1;
  const dead = attempts >= maxAttempts;
  await db.syncQueue.update(queueId, {
    status: dead ? "dead" : "pending",
    error: errorMsg,
    attempts
  });
  return { dead, attempts };
}

export async function getDeadSyncs() {
  return await db.syncQueue.where("status").equals("dead").toArray();
}

export async function retryDeadSyncs() {
  const dead = await db.syncQueue.where("status").equals("dead").toArray();
  await Promise.all(dead.map(item =>
    db.syncQueue.update(item.id, { status: "pending", attempts: 0, error: null })
  ));
  return dead.length;
}

// Points dans un rayon donné (m) — utilisé pour avertir d'un doublon probable
// avant de créer un nouveau point de recensement au même endroit.
export async function findNearbyPoints(lat, lon, radiusM = 25, excludeId = null) {
  const all = await db.points.toArray();
  const R = 6371000;
  return all.filter(p => {
    if (p.id === excludeId || p.lat == null || p.lon == null) return false;
    const dLat = (p.lat - lat) * Math.PI / 180;
    const dLon = (p.lon - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distM <= radiusM;
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

  // Ne supprimer QUE les entrées "update_visit" — conserver les "upsert_point"
  // (nouveaux points créés hors-ligne qui n'ont pas encore été synchronisés).
  // Avant ce correctif, syncQueue.clear() détruisait silencieusement ces fiches
  // et elles n'auraient jamais été poussées vers Supabase.
  await db.syncQueue.where("action").equals("update_visit").delete();
}

/**
 * Récupère l'état "visited" de tous les points depuis IndexedDB
 * sous forme de Map<pointId, visited>. Utilisé lors du rechargement
 * depuis Supabase pour préserver l'intention locale (un point marqué
 * "non visité" localement ne doit pas être re-écrasé par une valeur
 * serveur obsolète).
 */
export async function getLocalVisitedMap() {
  const all = await db.points.toArray();
  const map = new Map();
  for (const p of all) {
    if (p.id != null) map.set(p.id, !!p.visited);
  }
  return map;
}
