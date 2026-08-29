import Dexie from "dexie";
import { CONFIG } from "../core/config.js";
import { normalizePointId } from "../core/utils.js";

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

// Version 3 : photo obligatoire à la création d'une fiche (voir
// supabase/add_census_photos.sql). Table séparée de "points" — un Blob ne
// doit jamais transiter par le localStorage du brouillon (CENSUS_DRAFT_KEY,
// censusFormModal.js) ni par le payload JSON de syncQueue (upsert_point) :
// Dexie stocke les Blob nativement, syncQueue reste léger. `uploadStatus`
// suit le même vocabulaire que syncQueue ("pending"/"dead") pour rester
// cohérent avec le reste du moteur de sync.
db.version(3).stores({
  photos: "++id, pointId, uploadStatus"
});

// Version 4 : double envoi vers Google Sheets (voir
// supabase/functions/sheets-sync/index.ts, supabase/add_sheets_sync.sql).
// File SÉPARÉE de syncQueue : un échec d'envoi Sheets ne doit jamais
// retarder ni bloquer la synchro Supabase du point (déjà acceptée avant que
// ce flux ne soit même déclenché, voir syncEngine.js).
db.version(4).stores({
  sheetsQueue: "++id, pointId, status"
});

// === API haut niveau ===

export async function savePoints(pointsArray) {
  // TRANSACTION obligatoire : sans elle, deux chargements concurrents
  // (ex: double montage de l'app ou sync + refresh manuel) pouvaient
  // s'entrelacer — A.clear(), B.clear(), A.bulkAdd(505), B.bulkAdd(505) —
  // produisant des doublons ou une table vide. Dexie exécute maintenant
  // lecture + effacement + réécriture de façon atomique.
  return db.transaction("rw", db.points, async () => {
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
  });
}

export async function mergePoints(pointsArray) {
  return db.transaction("rw", db.points, async () => {
    const localPoints = await db.points.toArray();
    const incomingById = new Map(pointsArray.map(point => [point.id, point]));
    const merged = localPoints.map(point => {
      const incoming = incomingById.get(point.id);
      if (!incoming || !point.syncedAt) return point;
      return { ...incoming, localId: point.localId, syncedAt: new Date().toISOString() };
    });
    const existingIds = new Set(localPoints.map(point => point.id));
    for (const point of pointsArray) {
      if (!existingIds.has(point.id)) {
        merged.push({ ...point, localId: merged.length + 1, syncedAt: new Date().toISOString() });
      }
    }
    await db.points.clear();
    await db.points.bulkAdd(merged);
    return merged.length;
  });
}

export async function getAllPoints() {
  const all = await db.points.toArray();
  // Déduplication défensive par id (dernier gagnant) : des résidus de
  // doublons créés avant l'introduction de la transaction ci-dessus ne
  // doivent jamais remonter dans le store (marqueurs en double, stats
  // faussées). Le coût est négligeable même sur 10 000 points.
  const byId = new Map();
  for (const p of all) {
    if (p.id != null) byId.set(p.id, p);
  }
  return [...byId.values()];
}

export async function getPointById(id) {
  return await db.points.where("id").equals(id).first();
}

/**
 * @param {string} pointId
 * @param {boolean} visited
 * @param {string} status
 * @param {{lat:number, lng:number}|null} [position] Position GPS live au
 *   moment de l'action (store.get("geo.position")) — capturée ICI plutôt
 *   qu'au moment de la synchro (potentiellement bien plus tard, agent
 *   parti ailleurs) : voir assert_visit_geofence() (schema.sql) qui valide la
 *   distance côté serveur à partir de CES coordonnées soumises, jamais
 *   requise quand visited=false (aucun contrôle anti-fraude au décochage).
 */
export async function updatePointVisit(pointId, visited, status, position) {
  const point = await db.points.where("id").equals(pointId).first();
  if (!point) return null;

  // baseUpdatedAt : le "updated_at" serveur le plus récent connu de CET
  // appareil pour ce point (soit sa dernière synchro confirmée, soit le
  // updated_at reçu au dernier chargement Supabase). Transmis à syncEngine
  // pour détecter si un AUTRE agent a modifié ce point entre-temps — voir
  // syncOne()/mise à jour conditionnelle dans syncEngine.js.
  const baseUpdatedAt = point.updatedAt || null;

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
    payload: {
      visited,
      status,
      lat: visited && position ? position.lat : null,
      lon: visited && position ? position.lng : null
    },
    baseUpdatedAt,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending"
  });

  return updated;
}

export async function upsertPoint(pointData) {
  let point = await db.points.where("id").equals(pointData.id || "").first();
  const now = new Date().toISOString();
  // null pour un point tout neuf (rien n'existait avant -> aucun conflit
  // possible) ; sinon le updated_at serveur connu de cet appareil pour ce
  // point avant CETTE édition (voir commentaire équivalent dans
  // updatePointVisit()).
  const baseUpdatedAt = point?.updatedAt || null;
  let updated;
  let pendingSyncedFlag = false;
  if (point) {
    // BUG corrigé (audit) : syncedAt n'était PAS remis à null ici (seule la
    // branche "nouveau point" ci-dessous le faisait) — une édition locale
    // d'un point déjà synchronisé gardait donc son ANCIEN syncedAt truthy.
    // savePoints() (protection contre l'écrasement serveur) exclut les
    // points non synchronisés via `unsynced = localPoints.filter(p =>
    // !p.syncedAt)` : avec un syncedAt encore truthy, cette édition n'était
    // PAS protégée — un rechargement complet concurrent (boot de l'app,
    // triggerSync() et loadCensusData() tournent en parallèle sans
    // s'attendre, voir main.js) pouvait écraser silencieusement l'édition
    // locale par l'ancienne version serveur avant que la file de sync n'ait
    // eu le temps de la pousser.
    updated = {
      ...point,
      ...pointData,
      syncedAt: null,
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
      city: "",
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
      // createdAt posé ICI (pas seulement récupéré du serveur après sync) :
      // un rapport agent filtré par jour/semaine/mois (voir renderAgentPointsReport
      // dans appView.js) doit fonctionner même hors-ligne, avant tout aller-retour
      // Supabase — sinon un point créé le matin sans réseau n'apparaîtrait dans
      // aucune période tant que la synchro n'a pas eu lieu.
      createdAt: now,
      updatedAt: now
    };
    await db.points.add(updated);
  }

  await db.syncQueue.add({
    pointId: updated.id,
    action: "upsert_point",
    payload: updated,
    baseUpdatedAt,
    createdAt: now,
    attempts: 0,
    status: "pending"
  });

  return { ...updated, pendingSync: pendingSyncedFlag };
}

/**
 * Journalise une tournée optimisée terminée (approximation des kilomètres
 * parcourus par agent, voir supabase/add_tour_sessions.sql et
 * modules/report/agentReport.js). Passe par la même file `syncQueue` que les
 * points — même garanties offline-first (retry, dead-letter) — mais sans
 * `pointId` : markPointSynced(null, ...) ci-dessous ne trouve simplement
 * aucun point et ne fait rien, sans erreur (comportement Dexie voulu).
 */
export async function logTourSession({ distanceKm, stopCount, startedAt, endedAt }) {
  await db.syncQueue.add({
    pointId: null,
    action: "log_tour",
    payload: { distanceKm, stopCount, startedAt, endedAt },
    baseUpdatedAt: null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending"
  });
}

/**
 * Enfile une photo obligatoire de création pour upload (voir
 * modules/census/censusFormModal.js, supabase/add_census_photos.sql). Le
 * Blob déjà compressé (photoCompression.js) reste local jusqu'à ce que
 * syncEngine.js l'envoie à Supabase Storage — offline-first comme le reste
 * de la file de sync, mais dans sa PROPRE table (voir commentaire de
 * db.version(3) plus haut).
 */
export async function savePendingPhoto({ pointId, blob, mimeType }) {
  return await db.photos.add({
    pointId,
    blob,
    mimeType,
    createdAt: new Date().toISOString(),
    uploadStatus: "pending",
    attempts: 0
  });
}

export async function getPendingPhotos() {
  return await db.photos.where("uploadStatus").equals("pending").toArray();
}

export async function getDeadPhotos() {
  return await db.photos.where("uploadStatus").equals("dead").toArray();
}

export async function retryDeadPhotos() {
  const dead = await getDeadPhotos();
  await Promise.all(dead.map(p => db.photos.update(p.id, { uploadStatus: "pending", attempts: 0, error: null })));
  return dead.length;
}

/**
 * Upload confirmé par le serveur : le Blob local n'a plus besoin d'exister
 * (la preuve vit maintenant dans Supabase Storage, consultable par URL
 * signée à la demande — voir core/censusPhotos.js) — supprimé pour ne pas
 * accumuler indéfiniment des images dans IndexedDB, contrairement aux
 * points synchronisés qui restent utiles hors-ligne.
 */
export async function markPhotoSynced(photoId, photoPath) {
  const photo = await db.photos.get(photoId);
  if (!photo) return;
  await db.points.where("id").equals(photo.pointId).modify({ photoPath });
  await db.photos.delete(photoId);
}

export async function markPhotoFailed(photoId, errorMsg, maxAttempts = 3) {
  const photo = await db.photos.get(photoId);
  const attempts = (photo?.attempts || 0) + 1;
  const dead = attempts >= maxAttempts;
  await db.photos.update(photoId, { uploadStatus: dead ? "dead" : "pending", error: errorMsg, attempts });
  return { dead, attempts };
}

/**
 * Enfile (ou met à jour) une demande d'envoi vers Google Sheets — voir
 * syncEngine.js: syncOne(), supabase/functions/sheets-sync/index.ts. Un
 * agent qui modifie plusieurs fois le même point avant que la file ne se
 * vide ne doit PAS accumuler des entrées obsolètes : la dernière version
 * des champs remplace toujours l'entrée pending existante pour ce point,
 * plutôt que d'envoyer plusieurs lignes désynchronisées dans le désordre.
 */
export async function enqueueSheetsSync(pointId, fields) {
  const existingPending = await db.sheetsQueue
    .where("pointId").equals(pointId)
    .filter(item => item.status === "pending")
    .first();
  if (existingPending) {
    await db.sheetsQueue.update(existingPending.id, { fields, attempts: 0, error: null });
    return;
  }
  await db.sheetsQueue.add({ pointId, fields, status: "pending", attempts: 0 });
}

export async function getPendingSheetsSyncs() {
  return await db.sheetsQueue.where("status").equals("pending").toArray();
}

export async function markSheetsSyncDone(id) {
  await db.sheetsQueue.delete(id);
}

export async function markSheetsSyncFailed(id, errorMsg, maxAttempts = 3) {
  const item = await db.sheetsQueue.get(id);
  const attempts = (item?.attempts || 0) + 1;
  const dead = attempts >= maxAttempts;
  await db.sheetsQueue.update(id, { status: dead ? "dead" : "pending", error: errorMsg, attempts });
  return { dead, attempts };
}

export async function getDeadSheetsSyncs() {
  return await db.sheetsQueue.where("status").equals("dead").toArray();
}

export async function retryDeadSheetsSyncs() {
  const dead = await getDeadSheetsSyncs();
  await Promise.all(dead.map(item => db.sheetsQueue.update(item.id, { status: "pending", attempts: 0, error: null })));
  return dead.length;
}

export async function markPointSynced(pointId, completedQueueId = null) {
  const point = await db.points.where("id").equals(pointId).first();
  if (!point) return;
  const remaining = await db.syncQueue
    .where("pointId").equals(pointId)
    .filter(item => item.id !== completedQueueId && (item.status === "pending" || item.status === "dead"))
    .count();
  if (remaining > 0) return;
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

const CONFLICTS_META_KEY = "syncConflicts";

/**
 * Conflits d'édition concurrente : détectés par syncEngine.js quand une
 * écriture conditionnelle (basée sur le updated_at connu au moment de
 * l'édition locale, voir baseUpdatedAt ci-dessus) ne touche aucune ligne —
 * signe qu'un AUTRE agent a modifié ce point entre-temps. Persistés dans
 * la table "meta" (pas de nouvelle table Dexie pour un objet aussi simple)
 * pour survivre à un rechargement tant qu'un agent ne les a pas vus.
 */
export async function recordSyncConflict(conflict) {
  const existing = (await getMeta(CONFLICTS_META_KEY)) || [];
  const withoutSamePoint = existing.filter(c => c.pointId !== conflict.pointId);
  await setMeta(CONFLICTS_META_KEY, [...withoutSamePoint, conflict]);
}

export async function getSyncConflicts() {
  return (await getMeta(CONFLICTS_META_KEY)) || [];
}

export async function dismissSyncConflict(pointId) {
  const existing = (await getMeta(CONFLICTS_META_KEY)) || [];
  await setMeta(CONFLICTS_META_KEY, existing.filter(c => c.pointId !== pointId));
}

// Points dans un rayon donné (m) — utilisé pour avertir d'un doublon probable
// avant de créer un nouveau point de recensement au même endroit.
export async function findNearbyPoints(lat, lon, radiusM = 25, excludeId = null) {
  const all = await db.points.toArray();
  const R = 6371000;
  return all.filter(p => {
    if (normalizePointId(p.id) === normalizePointId(excludeId) || p.lat == null || p.lon == null) return false;
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

