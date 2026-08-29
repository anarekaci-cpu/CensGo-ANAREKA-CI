import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * triggerSheetsSync() (syncEngine.js) : double envoi best-effort vers
 * Google Sheets (supabase/functions/sheets-sync/index.ts) — un flux SÉPARÉ
 * de triggerSync(), qui ne doit jamais retarder ni bloquer la synchro
 * Supabase du point lui-même (voir plan Partie C).
 */

const dbMock = vi.hoisted(() => ({
  getPendingSyncs: vi.fn(async () => []),
  markSyncDone: vi.fn(async () => {}),
  markSyncFailed: vi.fn(async () => {}),
  markPointSynced: vi.fn(async () => {}),
  getDeadSyncs: vi.fn(async () => []),
  retryDeadSyncs: vi.fn(async () => 0),
  recordSyncConflict: vi.fn(async () => {}),
  getSyncConflicts: vi.fn(async () => []),
  dismissSyncConflict: vi.fn(async () => {}),
  getPendingPhotos: vi.fn(async () => []),
  getDeadPhotos: vi.fn(async () => []),
  retryDeadPhotos: vi.fn(async () => 0),
  markPhotoSynced: vi.fn(async () => {}),
  markPhotoFailed: vi.fn(async () => ({ dead: false, attempts: 1 })),
  getPointById: vi.fn(async () => null),
  enqueueSheetsSync: vi.fn(async () => {}),
  getPendingSheetsSyncs: vi.fn(async () => []),
  markSheetsSyncDone: vi.fn(async () => {}),
  markSheetsSyncFailed: vi.fn(async () => ({ dead: false, attempts: 1 })),
  getDeadSheetsSyncs: vi.fn(async () => []),
  retryDeadSheetsSyncs: vi.fn(async () => 0)
}));

vi.mock("../db/database.js", () => dbMock);

// ENABLE_SHEETS_SYNC est désactivé par défaut hors configuration explicite
// (voir core/config.js — évite d'activer ce flux avant que la Edge
// Function ne soit réellement déployée) : forcé à true ici pour tester la
// LOGIQUE de triggerSheetsSync() indépendamment de ce garde-fou de rollout.
vi.mock("../core/config.js", () => ({
  CONFIG: { ENABLE_SHEETS_SYNC: true, MAX_RETRY_ATTEMPTS: 3 }
}));

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    functions: { invoke: invokeMock }
  }))
}));

const { store } = await import("../core/store.js");
const { triggerSheetsSync } = await import("../modules/sync/syncEngine.js");

function queueItem(overrides = {}) {
  return { id: 1, pointId: "p1", fields: { name: "Chez Awa" }, status: "pending", attempts: 0, ...overrides };
}

describe("triggerSheetsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.set("user", { id: "agent-1" });
    dbMock.getPendingSheetsSyncs.mockResolvedValue([]);
    dbMock.getDeadSheetsSyncs.mockResolvedValue([]);
    invokeMock.mockResolvedValue({ error: null });
  });

  it("envoi réussi : marque l'entrée comme faite", async () => {
    dbMock.getPendingSheetsSyncs.mockResolvedValue([queueItem()]);

    await triggerSheetsSync();

    expect(invokeMock).toHaveBeenCalledWith("sheets-sync", { body: { pointId: "p1", fields: { name: "Chez Awa" } } });
    expect(dbMock.markSheetsSyncDone).toHaveBeenCalledWith(1);
    expect(dbMock.markSheetsSyncFailed).not.toHaveBeenCalled();
  });

  it("échec d'un envoi : marqué en échec, n'empêche pas les suivants (best-effort isolé)", async () => {
    invokeMock.mockResolvedValueOnce({ error: { message: "quota Google dépassé" } });
    dbMock.getPendingSheetsSyncs.mockResolvedValue([
      queueItem({ id: 1, pointId: "p1" }),
      queueItem({ id: 2, pointId: "p2" })
    ]);

    await triggerSheetsSync();

    expect(dbMock.markSheetsSyncFailed).toHaveBeenCalledWith(1, "quota Google dépassé", expect.any(Number));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(dbMock.markSheetsSyncDone).toHaveBeenCalledWith(2);
  });

  it("aucune entrée en attente : ne contacte pas la Edge Function", async () => {
    dbMock.getDeadSheetsSyncs.mockResolvedValue([{ id: 9 }, { id: 10 }]);

    await triggerSheetsSync();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.get("sync.deadSheetsCount")).toBe(2);
  });

  it("pas d'utilisateur connecté : ne tente rien", async () => {
    store.set("user", null);
    dbMock.getPendingSheetsSyncs.mockResolvedValue([queueItem()]);

    await triggerSheetsSync();

    expect(dbMock.getPendingSheetsSyncs).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
