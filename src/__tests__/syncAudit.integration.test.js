import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests d'intégration (Dexie sur fake-indexeddb + faux client Supabase) des
 * correctifs de l'audit sync : H1 (dédup), H2 (updated_at serveur),
 * M1 (retry dead sélectif), M2 (concurrence par point), M3 (idempotence),
 * M4 (préservation locale), M5 (statut), géofence serveur, lows.
 */

let fakeSupabase = null;
vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: () => fakeSupabase
}));

const SERVER_TS = "2026-03-01T12:00:00.000Z";

/**
 * Faux client PostgREST : chaque appel from()/rpc() renvoie un builder
 * chaînable et "thenable" qui journalise l'opération puis résout via
 * `respond(call)`.
 */
function makeSupabase({ respond, delayMs = 0 } = {}) {
  const calls = [];
  const inflight = new Map();
  const stats = { maxConcurrent: 0, maxPerKey: 0, current: 0 };
  const defaultRespond = (call) => {
    if (call.maybeSingle) return { data: null, error: null };
    return { data: [{ point_id: call.key, updated_at: SERVER_TS }], error: null };
  };
  const handler = respond || defaultRespond;

  function builder(table) {
    const call = { table, op: "select", payload: null, opts: null, eqs: {}, selectCols: null, maybeSingle: false, key: null };
    calls.push(call);
    const b = {
      insert(p, o) { call.op = "insert"; call.payload = p; call.opts = o; return b; },
      update(p) { call.op = "update"; call.payload = p; return b; },
      upsert(p, o) { call.op = "upsert"; call.payload = p; call.opts = o; return b; },
      select(c) { call.selectCols = c ?? "*"; return b; },
      eq(k, v) { call.eqs[k] = v; return b; },
      order() { return b; },
      limit() { return b; },
      abortSignal() { return b; },
      maybeSingle() { call.maybeSingle = true; return b; },
      then(resolve, reject) {
        call.key = call.payload?.point_id ?? call.eqs.point_id ?? call.payload?.id ?? null;
        const run = async () => {
          stats.current++;
          stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.current);
          const n = (inflight.get(call.key) || 0) + 1;
          inflight.set(call.key, n);
          stats.maxPerKey = Math.max(stats.maxPerKey, n);
          if (delayMs) await new Promise(r => setTimeout(r, delayMs));
          inflight.set(call.key, inflight.get(call.key) - 1);
          stats.current--;
          return handler(call);
        };
        return run().then(resolve, reject);
      }
    };
    return b;
  }

  const uploads = [];
  const client = {
    calls,
    stats,
    uploads,
    from: (t) => builder(t),
    rpc: (name, args) => {
      const b = builder(`rpc:${name}`);
      b.payload = args;
      return b;
    },
    storage: {
      from: () => ({
        upload: async (path, blob, opts) => { uploads.push({ path, opts }); return { error: null }; }
      })
    }
  };
  return client;
}

const { db, updatePointVisit, upsertPoint, savePoints, mergePoints, markPointSynced,
  markSyncFailed, retryDeadSyncs, logTourSession, addHazard, savePendingPhoto,
  getPendingSyncs, getDeadSyncs } = await import("../db/database.js");
const { store } = await import("../core/store.js");
const engine = await import("../modules/sync/syncEngine.js");
const { triggerSync, triggerHazardSync, triggerPhotoUpload } = engine;
const { isTransientSyncError } = await import("../db/syncErrors.js");

function seedPoint(over = {}) {
  return {
    id: "p1", block: 1, order: 1, name: "A", status: "VERT (Joignable)", visited: false,
    lat: 5.3, lon: -4.0, syncedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...over
  };
}

const POS = { lat: 5.3, lng: -4.0, accuracy: 12, timestamp: Date.parse("2026-03-01T11:59:30.000Z") };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  fakeSupabase = makeSupabase();
  store.set("user", { id: "agent-1" });
  store.set("sync.status", "idle");
});

afterEach(() => { vi.restoreAllMocks(); });

describe("H1 — dedup : les items écartés sont supprimés de la file", () => {
  it("3 update_visit sur le même point -> 1 seul envoi, file vidée, aucune valeur périmée renvoyée", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    await updatePointVisit("p1", true, "VERT (Joignable)", POS);
    await updatePointVisit("p1", false, "VERT (Joignable)", POS);
    await updatePointVisit("p1", true, "VERT (Joignable)", POS);

    await triggerSync();

    const updates = fakeSupabase.calls.filter(c => c.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.visited).toBe(true);
    expect(await db.syncQueue.count()).toBe(0);

    // Un second cycle ne doit rien renvoyer (avant : les écartés restaient pending).
    await triggerSync();
    expect(fakeSupabase.calls.filter(c => c.op === "update")).toHaveLength(1);
  });
});

describe("H2 — updated_at serveur", () => {
  it("n'envoie plus l'horloge client et stocke l'updated_at renvoyé", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    await updatePointVisit("p1", true, "VERT (Joignable)", POS);

    await triggerSync();

    const upd = fakeSupabase.calls.find(c => c.op === "update");
    expect(upd.payload).not.toHaveProperty("updated_at");
    expect(upd.selectCols).toContain("updated_at");
    const p = await db.points.where("id").equals("p1").first();
    expect(p.updatedAt).toBe(SERVER_TS);
    expect(p.syncedAt).toBeTruthy();
  });

  it("upsert_point : pas d'updated_at client, updated_at serveur stocké", async () => {
    await upsertPoint({ id: "arka_new", name: "Nouveau" });
    await triggerSync();
    const up = fakeSupabase.calls.find(c => c.op === "upsert" && c.table !== "tour_sessions");
    expect(up.payload).not.toHaveProperty("updated_at");
    expect(up.selectCols).toContain("updated_at");
    const p = await db.points.where("id").equals("arka_new").first();
    expect(p.updatedAt).toBe(SERVER_TS);
  });

  it("markPointSynced rebase les items restants du point sur l'updated_at serveur", async () => {
    await db.points.add({ ...seedPoint(), localId: 1, syncedAt: null });
    const a = await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, baseUpdatedAt: "x", createdAt: "1", status: "pending", attempts: 0 });
    const b = await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, baseUpdatedAt: "local-clock", createdAt: "2", status: "pending", attempts: 0 });
    await markPointSynced("p1", a, SERVER_TS);
    expect((await db.syncQueue.get(b)).baseUpdatedAt).toBe(SERVER_TS);
  });
});

describe("M1 — retryDeadSyncs sélectif", () => {
  it("isTransientSyncError classe réseau/5xx/timeout vs 4xx/RLS/métier", () => {
    expect(isTransientSyncError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientSyncError({ message: "AbortError: aborted" })).toBe(true);
    expect(isTransientSyncError({ status: 503, message: "x" })).toBe(true);
    expect(isTransientSyncError({ status: 429, message: "x" })).toBe(true);
    expect(isTransientSyncError({ message: "Vérification de version serveur indisponible" })).toBe(true);
    expect(isTransientSyncError({ code: "42501", message: "row-level security" })).toBe(false);
    expect(isTransientSyncError({ code: "P0001", message: "Trop loin du point" })).toBe(false);
    expect(isTransientSyncError({ status: 400, message: "bad" })).toBe(false);
    expect(isTransientSyncError({ status: 403, message: "bad" })).toBe(false);
  });

  it("retry automatique : relance seulement les transitoires", async () => {
    const t = await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, createdAt: "1", status: "dead", attempts: 3, error: "Failed to fetch", transient: true });
    const f = await db.syncQueue.add({ pointId: "p2", action: "update_visit", payload: {}, createdAt: "2", status: "dead", attempts: 3, error: "RLS", transient: false });
    const legacy = await db.syncQueue.add({ pointId: "p3", action: "update_visit", payload: {}, createdAt: "3", status: "dead", attempts: 3, error: "new row violates row-level security policy" });

    const n = await retryDeadSyncs({ onlyTransient: true });

    expect(n).toBe(1);
    expect((await db.syncQueue.get(t)).status).toBe("pending");
    expect((await db.syncQueue.get(f)).status).toBe("dead");
    expect((await db.syncQueue.get(legacy)).status).toBe("dead");
  });

  it("action explicite (défaut) : relance tout", async () => {
    await db.syncQueue.add({ pointId: "p2", action: "update_visit", payload: {}, createdAt: "2", status: "dead", attempts: 3, error: "RLS", transient: false });
    expect(await retryDeadSyncs()).toBe(1);
  });

  it("markSyncFailed mémorise le caractère transitoire", async () => {
    const id = await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, createdAt: "1", status: "pending", attempts: 0 });
    await markSyncFailed(id, "boom", 3, { transient: false });
    expect((await db.syncQueue.get(id)).transient).toBe(false);
  });

  it("une erreur permanente (42501) est dead immédiatement, sans réessai inline", async () => {
    fakeSupabase = makeSupabase({ respond: () => ({ data: null, error: { code: "42501", message: "row-level security" } }) });
    await db.points.add({ ...seedPoint(), localId: 1 });
    await updatePointVisit("p1", false, "VERT (Joignable)", null);
    await triggerSync();
    expect(fakeSupabase.calls.filter(c => c.op === "update")).toHaveLength(1);
    const dead = await getDeadSyncs();
    expect(dead).toHaveLength(1);
    expect(dead[0].transient).toBe(false);
  });
});

describe("M2 — concurrence par point", () => {
  it("séquentiel pour un même pointId, parallèle entre points", async () => {
    fakeSupabase = makeSupabase({ delayMs: 15 });
    for (const id of ["p1", "p2", "p3"]) await upsertPoint({ id, name: id });
    await upsertPoint({ id: "p1", name: "p1-b" });
    await upsertPoint({ id: "p1", name: "p1-c" });

    await triggerSync();

    const ups = fakeSupabase.calls.filter(c => c.op === "upsert");
    expect(ups).toHaveLength(5);
    expect(fakeSupabase.stats.maxPerKey).toBe(1);
    expect(fakeSupabase.stats.maxConcurrent).toBeGreaterThan(1);
    const p1Names = ups.filter(c => c.payload.point_id === "p1").map(c => c.payload.name);
    expect(p1Names).toEqual(["p1", "p1-b", "p1-c"]);
  });
});

describe("M3 — idempotence", () => {
  it("log_tour : id client + upsert ignoreDuplicates", async () => {
    await logTourSession({ distanceKm: 3, stopCount: 2, startedAt: "a", endedAt: "b" });
    const [item] = await getPendingSyncs();
    expect(item.payload.id).toMatch(/^[0-9a-f-]{36}$/);

    await triggerSync();
    const c = fakeSupabase.calls.find(x => x.table === "tour_sessions");
    expect(c.op).toBe("upsert");
    expect(c.payload.id).toBe(item.payload.id);
    expect(c.opts).toEqual(expect.objectContaining({ onConflict: "id", ignoreDuplicates: true }));
  });

  it("danger : upsert sur id", async () => {
    await addHazard({ hazardType: "flood", note: "n", lat: 1, lon: 2 });
    await triggerHazardSync();
    const c = fakeSupabase.calls.find(x => x.table === "hazard_markers");
    expect(c.op).toBe("upsert");
    expect(c.opts).toEqual(expect.objectContaining({ onConflict: "id" }));
  });

  it("photo : chemin déterministe + upsert:true", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    await savePendingPhoto({ pointId: "p1", blob: new Blob(["x"]), mimeType: "image/jpeg" });
    let n = 0;
    fakeSupabase = makeSupabase({ respond: () => (++n === 1 ? { error: { message: "Failed to fetch" } } : { error: null }) });
    await triggerPhotoUpload(); // update échoue -> photo reste pending
    await triggerPhotoUpload();
    expect(fakeSupabase.uploads).toHaveLength(2);
    expect(fakeSupabase.uploads[0].path).toBe(fakeSupabase.uploads[1].path);
    expect(fakeSupabase.uploads[0].opts.upsert).toBe(true);
  });
});

describe("M4 — préservation de l'état local", () => {
  it("point synchronisé sans file : la valeur serveur gagne", async () => {
    await db.points.add({ ...seedPoint({ visited: true }), localId: 1 });
    await savePoints([{ id: "p1", block: 1, order: 1, visited: false }]);
    expect((await db.points.where("id").equals("p1").first()).visited).toBe(false);
  });

  it("point avec entrée pending : l'état local est préservé (savePoints et mergePoints)", async () => {
    await db.points.add({ ...seedPoint({ visited: true }), localId: 1 });
    await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, createdAt: "1", status: "pending", attempts: 0 });
    await savePoints([{ id: "p1", block: 1, order: 1, visited: false }]);
    expect((await db.points.where("id").equals("p1").first()).visited).toBe(true);
    await mergePoints([{ id: "p1", block: 1, order: 1, visited: false }]);
    expect((await db.points.where("id").equals("p1").first()).visited).toBe(true);
  });

  it("point avec entrée dead : préservé aussi", async () => {
    await db.points.add({ ...seedPoint({ visited: true }), localId: 1 });
    await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: {}, createdAt: "1", status: "dead", attempts: 3 });
    await mergePoints([{ id: "p1", block: 1, order: 1, visited: false }]);
    expect((await db.points.where("id").equals("p1").first()).visited).toBe(true);
  });

  it("updatePointVisit remet syncedAt à null", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    const updated = await updatePointVisit("p1", true, "VERT (Joignable)", POS);
    expect(updated.syncedAt).toBeNull();
    expect((await db.points.where("id").equals("p1").first()).syncedAt).toBeNull();
  });
});

describe("M5 — statut syncing bloqué", () => {
  it("tout en backoff -> pas de statut 'syncing'", async () => {
    await db.syncQueue.add({ pointId: "p1", action: "update_visit", payload: { visited: false }, createdAt: "1", status: "pending", attempts: 1, nextRetryAt: new Date(Date.now() + 3600e3).toISOString() });
    await triggerSync();
    expect(store.get("sync.status")).not.toBe("syncing");
    expect(store.get("sync.pendingCount")).toBe(1);
    expect(fakeSupabase.calls).toHaveLength(0);
  });
});

describe("Géofence serveur", () => {
  it("update_visit visited=true envoie visit_lat/lon/accuracy/at dans la même ligne, RPC conservé", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    await updatePointVisit("p1", true, "VERT (Joignable)", POS);
    await triggerSync();
    expect(fakeSupabase.calls.some(c => c.table === "rpc:assert_visit_geofence")).toBe(true);
    const upd = fakeSupabase.calls.find(c => c.op === "update");
    expect(upd.payload).toEqual(expect.objectContaining({
      visited: true,
      visit_lat: 5.3,
      visit_lon: -4.0,
      visit_accuracy: 12,
      visit_at: new Date(POS.timestamp).toISOString()
    }));
  });

  it("visited=false : pas de champs visit_*", async () => {
    await db.points.add({ ...seedPoint({ visited: true }), localId: 1 });
    await updatePointVisit("p1", false, "VERT (Joignable)", POS);
    await triggerSync();
    const upd = fakeSupabase.calls.find(c => c.op === "update");
    expect(upd.payload).not.toHaveProperty("visit_lat");
    expect(fakeSupabase.calls.some(c => c.table === "rpc:assert_visit_geofence")).toBe(false);
  });

  it("l'upsert initial n'envoie jamais visited", async () => {
    await upsertPoint({ id: "arka_v", name: "V", visited: true });
    await triggerSync();
    const up = fakeSupabase.calls.find(c => c.op === "upsert");
    expect(up.payload).not.toHaveProperty("visited");
  });
});

describe("Lows", () => {
  it("upsertPoint concurrents : localId distincts (transaction)", async () => {
    await Promise.all([1, 2, 3, 4, 5].map(i => upsertPoint({ name: `n${i}` })));
    const all = await db.points.toArray();
    expect(all).toHaveLength(5);
    expect(new Set(all.map(p => p.localId)).size).toBe(5);
  });

  it("mergePoints : localId = max+1 (pas de collision)", async () => {
    await db.points.bulkAdd([
      { ...seedPoint({ id: "a" }), localId: 2 },
      { ...seedPoint({ id: "b" }), localId: 3 }
    ]);
    await mergePoints([{ id: "c", block: 1, order: 3 }]);
    const all = await db.points.toArray();
    expect(all).toHaveLength(3);
    expect(all.find(p => p.id === "c").localId).toBe(4);
  });

  it("initSyncEngine est idempotent", async () => {
    const spy = vi.spyOn(window, "addEventListener");
    await engine.initSyncEngine();
    await engine.initSyncEngine();
    expect(spy.mock.calls.filter(([e]) => e === "online")).toHaveLength(1);
  });

  it("les timers de timeout (15 s) sont tous nettoyés après un upload", async () => {
    await db.points.add({ ...seedPoint(), localId: 1 });
    await savePendingPhoto({ pointId: "p1", blob: new Blob(["x"]), mimeType: "image/jpeg" });
    const created = [];
    const realSet = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms, ...a) => {
      const id = realSet(fn, ms, ...a);
      if (ms === 15000) created.push(id);
      return id;
    });
    const cleared = [];
    const realClear = globalThis.clearTimeout;
    vi.spyOn(globalThis, "clearTimeout").mockImplementation((id) => { cleared.push(id); return realClear(id); });

    await triggerPhotoUpload();

    expect(created.length).toBeGreaterThan(0);
    for (const id of created) expect(cleared).toContain(id);
  });
});
