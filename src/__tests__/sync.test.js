import { describe, it, expect } from "vitest";
import { dedupSyncQueue } from "../modules/sync/syncEngine.js";

const visit = (id, pointId, createdAt) => ({
  id, pointId, action: "update_visit", createdAt,
  payload: { visited: true }
});
const upsert = (id, pointId, createdAt) => ({
  id, pointId, action: "upsert_point", createdAt,
  payload: { id: pointId }
});

describe("dedupSyncQueue", () => {
  it("garde uniquement la dernière update_visit par point", () => {
    const out = dedupSyncQueue([
      visit(1, "p1", "2026-01-01T10:00:00Z"),
      visit(2, "p1", "2026-01-01T11:00:00Z"),
      visit(3, "p1", "2026-01-01T09:00:00Z")
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });

  it("ne déduplique PAS les upsert_point (données différentes)", () => {
    const out = dedupSyncQueue([
      upsert(1, "p1", "2026-01-01T10:00:00Z"),
      upsert(2, "p1", "2026-01-01T11:00:00Z")
    ]);
    expect(out).toHaveLength(2);
  });

  it("mélange update_visit + upsert_point", () => {
    const out = dedupSyncQueue([
      visit(1, "p1", "2026-01-01T10:00:00Z"),
      visit(2, "p1", "2026-01-02T10:00:00Z"),
      upsert(3, "p2", "2026-01-01T10:00:00Z"),
      visit(4, "p3", "2026-01-01T10:00:00Z")
    ]);
    expect(out).toHaveLength(3);
    expect(out.filter(i => i.action === "update_visit").map(i => i.id).sort())
      .toEqual([2, 4]);
  });

  it("file vide -> []", () => {
    expect(dedupSyncQueue([])).toEqual([]);
  });
});
