import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * BUG corrigé (audit) : triggerSync() posait isSyncing = true APRÈS son
 * premier `await` (getPendingSyncs()) — deux appels quasi simultanés
 * (déclenchement de boot + "visibilitychange" au premier plan, tous deux
 * vrais à l'ouverture de l'app en ligne) passaient TOUS LES DEUX la garde de
 * ré-entrance avant que l'un ou l'autre ne pose le flag, et traitaient la
 * même file en parallèle — pour un "update_visit", la seconde exécution
 * retrouvait un `updated_at` déjà changé par la première et déclenchait un
 * FAUX conflit de sync, signalé à tort à l'agent.
 *
 * Ce test prouve que le flag ferme désormais la fenêtre : deux appels
 * concurrents à triggerSync() ne doivent traiter la file qu'UNE SEULE fois.
 */

const dbMock = vi.hoisted(() => ({
  getPendingSyncs: vi.fn(),
  markSyncDone: vi.fn(),
  markSyncFailed: vi.fn(),
  markPointSynced: vi.fn(),
  getDeadSyncs: vi.fn(async () => []),
  retryDeadSyncs: vi.fn(),
  recordSyncConflict: vi.fn(),
  getSyncConflicts: vi.fn(async () => []),
  dismissSyncConflict: vi.fn()
}));

vi.mock("../db/database.js", () => dbMock);
vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: vi.fn(() => ({}))
}));

const { store } = await import("../core/store.js");
const { triggerSync } = await import("../modules/sync/syncEngine.js");

describe("triggerSync — garde de ré-entrance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getDeadSyncs.mockResolvedValue([]);
    dbMock.getSyncConflicts.mockResolvedValue([]);
    store.set("user", { id: "agent-1" });
  });

  it("deux appels concurrents ne traitent la file qu'une seule fois", async () => {
    // getPendingSyncs() résout après un micro-délai pour simuler la fenêtre
    // de suspension entre la vérification et l'action — c'est exactement le
    // scénario qui déclenchait la course avant le correctif.
    dbMock.getPendingSyncs.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5))
    );

    await Promise.all([triggerSync(), triggerSync()]);

    // Avec le flag posé AVANT le premier await, le second appel retourne
    // immédiatement sans jamais lire la file — un seul appel réel.
    expect(dbMock.getPendingSyncs).toHaveBeenCalledTimes(1);
  });
});
