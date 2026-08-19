import { describe, it, expect, vi } from "vitest";
import { store } from "../core/store.js";

describe("Store", () => {
  it("gets top-level state", () => {
    expect(store.get("user")).toBeNull();
    expect(store.get("points")).toEqual([]);
  });

  it("gets nested state via dot path", () => {
    expect(store.get("geo.tracking")).toBe(false);
    expect(store.get("navigation.active")).toBe(false);
    expect(store.get("sync.status")).toBe("idle");
  });

  it("sets and gets values", () => {
    store.set("ui.loading", false);
    expect(store.get("ui.loading")).toBe(false);
  });

  it("does not notify when value is unchanged", () => {
    const cb = vi.fn();
    const unsub = store.subscribe("sync.status", cb);
    store.set("sync.status", "idle");
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it("update() with function updater", () => {
    store.set("points", [{ id: 1 }, { id: 2 }]);
    store.update("points", (pts) => [...pts, { id: 3 }]);
    expect(store.get("points")).toHaveLength(3);
  });
});
