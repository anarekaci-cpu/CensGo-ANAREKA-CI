import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * triggerPhotoUpload() (syncEngine.js) : envoi best-effort des photos
 * obligatoires de création (censusFormModal.js) vers Supabase Storage —
 * un flux SÉPARÉ de triggerSync(), qui ne doit jamais bloquer la
 * synchronisation du point lui-même (voir plan Partie B).
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
  markPhotoFailed: vi.fn(async () => ({ dead: false, attempts: 1 }))
}));

vi.mock("../db/database.js", () => dbMock);

const uploadMock = vi.hoisted(() => vi.fn());
const updateEqMock = vi.hoisted(() => vi.fn());

vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    storage: { from: () => ({ upload: uploadMock }) },
    from: () => ({
      update: () => ({
        eq: () => ({ abortSignal: async () => updateEqMock() })
      })
    })
  }))
}));

const { store } = await import("../core/store.js");
const { triggerPhotoUpload } = await import("../modules/sync/syncEngine.js");

function photo(overrides = {}) {
  return {
    id: 1,
    pointId: "p1",
    blob: new Blob(["fake"], { type: "image/jpeg" }),
    mimeType: "image/jpeg",
    uploadStatus: "pending",
    attempts: 0,
    ...overrides
  };
}

describe("triggerPhotoUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.set("user", { id: "agent-1" });
    dbMock.getPendingPhotos.mockResolvedValue([]);
    dbMock.getDeadPhotos.mockResolvedValue([]);
    uploadMock.mockResolvedValue({ error: null });
    updateEqMock.mockResolvedValue({ error: null });
  });

  it("upload réussi : marque la photo synchronisée, jamais en échec", async () => {
    dbMock.getPendingPhotos.mockResolvedValue([photo()]);

    await triggerPhotoUpload();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(dbMock.markPhotoSynced).toHaveBeenCalledWith(1, expect.stringContaining("agent-1/p1-"));
    expect(dbMock.markPhotoFailed).not.toHaveBeenCalled();
  });

  it("échec d'upload Storage : marque la photo en échec, ne bloque pas les autres", async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: "quota dépassé" } });
    dbMock.getPendingPhotos.mockResolvedValue([photo({ id: 1, pointId: "p1" }), photo({ id: 2, pointId: "p2" })]);

    await triggerPhotoUpload();

    expect(dbMock.markPhotoFailed).toHaveBeenCalledWith(1, "quota dépassé", expect.any(Number));
    // La seconde photo doit quand même être tentée (échec isolé, pas de throw global).
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(dbMock.markPhotoSynced).toHaveBeenCalledWith(2, expect.any(String));
  });

  it("échec de mise à jour photo_path après upload réussi : compte comme échec (pas de synced silencieux)", async () => {
    updateEqMock.mockResolvedValueOnce({ error: { message: "RLS" } });
    dbMock.getPendingPhotos.mockResolvedValue([photo()]);

    await triggerPhotoUpload();

    expect(dbMock.markPhotoSynced).not.toHaveBeenCalled();
    expect(dbMock.markPhotoFailed).toHaveBeenCalled();
  });

  it("aucune photo en attente : ne touche pas Storage, met juste à jour deadPhotoCount", async () => {
    dbMock.getDeadPhotos.mockResolvedValue([{ id: 9 }]);

    await triggerPhotoUpload();

    expect(uploadMock).not.toHaveBeenCalled();
    expect(store.get("sync.deadPhotoCount")).toBe(1);
  });

  it("pas d'utilisateur connecté : ne tente rien (RLS refuserait tout)", async () => {
    store.set("user", null);
    dbMock.getPendingPhotos.mockResolvedValue([photo()]);

    await triggerPhotoUpload();

    expect(dbMock.getPendingPhotos).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
