import { describe, it, expect } from "vitest";
import { isPurgeableSyncItem, DEAD_SYNC_MAX_AGE_MS } from "../core/syncQueueMaintenance.js";

const now = Date.parse("2026-02-01T00:00:00.000Z");
const iso = (ms) => new Date(now - ms).toISOString();

describe("isPurgeableSyncItem", () => {
  it("conserve les entrées 'pending'", () => {
    expect(isPurgeableSyncItem({ status: "pending", createdAt: iso(0) }, { now })).toBe(false);
  });

  it("conserve une entrée 'dead' récente", () => {
    expect(isPurgeableSyncItem({ status: "dead", createdAt: iso(DEAD_SYNC_MAX_AGE_MS - 1000) }, { now })).toBe(false);
  });

  it("purge une entrée 'dead' plus vieille que la fenêtre", () => {
    expect(isPurgeableSyncItem({ status: "dead", createdAt: iso(DEAD_SYNC_MAX_AGE_MS + 1000) }, { now })).toBe(true);
  });

  it("purge tout statut terminal orphelin (ni pending ni dead)", () => {
    expect(isPurgeableSyncItem({ status: "failed", createdAt: iso(0) }, { now })).toBe(true);
    expect(isPurgeableSyncItem({ status: "done", createdAt: iso(0) }, { now })).toBe(true);
    expect(isPurgeableSyncItem({ status: undefined }, { now })).toBe(true);
  });

  it("entrée 'dead' sans createdAt lisible -> conservée (on ne devine pas son âge)", () => {
    expect(isPurgeableSyncItem({ status: "dead" }, { now })).toBe(false);
    expect(isPurgeableSyncItem({ status: "dead", createdAt: "n'importe quoi" }, { now })).toBe(false);
  });

  it("item nul -> false", () => {
    expect(isPurgeableSyncItem(null)).toBe(false);
    expect(isPurgeableSyncItem(undefined)).toBe(false);
  });
});
