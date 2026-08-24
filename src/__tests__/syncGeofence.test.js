import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * BUG corrigé (audit sécu) : le contrôle de proximité GPS anti-fraude
 * n'existait qu'en JS côté client (core/geofence.js) — un appel direct à
 * l'API Supabase pouvait marquer n'importe quel point "visité" sans jamais
 * passer par ce contrôle. syncOne() (syncEngine.js) appelle désormais le RPC
 * assert_visit_geofence() AVANT toute mise à jour, uniquement quand
 * payload.visited === true (jamais au décochage).
 */

const dbMock = vi.hoisted(() => ({
  getPendingSyncs: vi.fn(),
  markSyncDone: vi.fn(async () => {}),
  markSyncFailed: vi.fn(async () => {}),
  markPointSynced: vi.fn(async () => {}),
  getDeadSyncs: vi.fn(async () => []),
  retryDeadSyncs: vi.fn(),
  recordSyncConflict: vi.fn(),
  getSyncConflicts: vi.fn(async () => []),
  dismissSyncConflict: vi.fn()
}));

vi.mock("../db/database.js", () => dbMock);

const rpcMock = vi.hoisted(() => vi.fn());
const updateChainMock = vi.hoisted(() => vi.fn());

vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    rpc: rpcMock,
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              abortSignal: async () => updateChainMock()
            })
          }),
          // baseUpdatedAt absent -> une seule .eq(), donc .select() direct
          select: () => ({
            abortSignal: async () => updateChainMock()
          })
        })
      })
    })
  }))
}));

const { store } = await import("../core/store.js");
const { triggerSync } = await import("../modules/sync/syncEngine.js");

function queueItem(overrides = {}) {
  return {
    id: 1,
    pointId: "p1",
    action: "update_visit",
    payload: { visited: true, status: "VERT (Joignable)", lat: 5.37, lon: -3.97 },
    baseUpdatedAt: null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
    ...overrides
  };
}

describe("syncOne — géofence anti-fraude appliquée côté serveur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.set("user", { id: "agent-1" });
    dbMock.getPendingSyncs.mockResolvedValue([]);
    updateChainMock.mockResolvedValue({ data: [{ point_id: "p1" }], error: null });
    rpcMock.mockReturnValue({ abortSignal: async () => ({ error: null }) });
  });

  it("appelle assert_visit_geofence avec les coordonnées capturées quand visited=true", async () => {
    dbMock.getPendingSyncs.mockResolvedValue([queueItem()]);

    await triggerSync();

    expect(rpcMock).toHaveBeenCalledWith("assert_visit_geofence", {
      p_point_id: "p1",
      p_lat: 5.37,
      p_lon: -3.97
    });
    expect(dbMock.markSyncDone).toHaveBeenCalledWith(1);
  });

  it("n'appelle PAS assert_visit_geofence au décochage (visited=false)", async () => {
    dbMock.getPendingSyncs.mockResolvedValue([
      queueItem({ payload: { visited: false, status: "VERT (Joignable)", lat: null, lon: null } })
    ]);

    await triggerSync();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(dbMock.markSyncDone).toHaveBeenCalledWith(1);
  });

  it("un refus serveur (trop loin) fait échouer la sync — pas de markSyncDone", async () => {
    dbMock.getPendingSyncs.mockResolvedValue([queueItem()]);
    rpcMock.mockReturnValue({
      abortSignal: async () => ({ error: { message: "Trop loin du point (800 m, max 500 m autorisés)" } })
    });

    await triggerSync();

    expect(dbMock.markSyncDone).not.toHaveBeenCalled();
    // 3 tentatives inline (syncWithConcurrency) avant markSyncFailed — voir
    // syncEngine.js. L'important : l'échec est bien remonté, jamais avalé.
    expect(dbMock.markSyncFailed).toHaveBeenCalled();
  });
});
