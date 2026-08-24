import { beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../core/store.js";
import { fetchAllPages } from "../modules/census/dataLoader.js";

function createQuery(response) {
  const query = {
    from: vi.fn(() => query),
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    gte: vi.fn(() => query),
    abortSignal: vi.fn(async () => response)
  };
  return query;
}

describe("fetchAllPages", () => {
  beforeEach(() => {
    store.set("sync.warning", null);
  });

  it("filtre les chargements ultérieurs avec updated_at", async () => {
    const query = createQuery({ data: [{ point_id: "p1" }], error: null });
    const supabase = { from: query.from };
    await fetchAllPages(supabase, { since: "2026-08-24T10:00:00.000Z" });
    expect(query.gte).toHaveBeenCalledWith("updated_at", "2026-08-24T10:00:00.000Z");
  });

  it("signale le nombre de pages et lignes reçues en cas d'interruption", async () => {
    const query = createQuery({ data: Array.from({ length: 1000 }, (_, index) => ({ point_id: `p${index}` })), error: null });
    query.abortSignal
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, index) => ({ point_id: `p${index}` })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const supabase = { from: query.from };
    const rows = await fetchAllPages(supabase);
    expect(rows).toHaveLength(1000);
    expect(store.get("sync.warning")).toContain("1 page(s), 1000 ligne(s)");
    expect(store.get("sync.partialLoad")).toEqual(expect.objectContaining({ pages: 1, rows: 1000 }));
  });

  it("nettoie le timer si la requête Supabase rejette sa promesse", async () => {
    vi.useFakeTimers();
    try {
      const query = createQuery(null);
      query.abortSignal.mockRejectedValueOnce(new Error("transport fermé"));
      const supabase = { from: query.from };
      await expect(fetchAllPages(supabase)).rejects.toThrow("transport fermé");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
