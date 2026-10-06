import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * H2 : lastSync = début du chargement moins une marge de sécurité (pas la
 * fin), pour ne pas manquer les lignes modifiées pendant le téléchargement.
 */
const metaStore = vi.hoisted(() => ({ values: {} }));
const query = vi.hoisted(() => ({}));

vi.mock("../db/database.js", () => ({
  savePoints: vi.fn(async () => 1),
  mergePoints: vi.fn(async () => 1),
  getAllPoints: vi.fn(async () => []),
  getMeta: vi.fn(async (k) => metaStore.values[k] ?? null),
  setMeta: vi.fn(async (k, v) => { metaStore.values[k] = v; })
}));
vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: () => ({ from: () => query })
}));

const { loadCensusData, LAST_SYNC_SAFETY_MARGIN_MS } = await import("../modules/census/dataLoader.js");

describe("dataLoader — curseur lastSync", () => {
  beforeEach(() => {
    metaStore.values = {};
    for (const m of ["select", "order", "range", "gte"]) query[m] = () => query;
    query.abortSignal = async () => {
      // Le temps passe pendant le téléchargement.
      vi.setSystemTime(new Date("2026-05-01T10:00:30.000Z"));
      return { data: [{ point_id: "p1", block: 1, order: 1, lat: 5, lon: -4 }], error: null };
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("enregistre le DÉBUT du chargement moins la marge, pas l'heure de fin", async () => {
    await loadCensusData(false, { forceRefresh: true });
    const expected = new Date(Date.parse("2026-05-01T10:00:00.000Z") - LAST_SYNC_SAFETY_MARGIN_MS).toISOString();
    expect(metaStore.values.lastSync).toBe(expected);
    expect(LAST_SYNC_SAFETY_MARGIN_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});
