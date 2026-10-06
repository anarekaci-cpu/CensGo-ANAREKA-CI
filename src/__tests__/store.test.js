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

describe("Store — dédup des notifications par chemin (M6)", () => {
  it("N set() du même chemin dans une frame -> 1 seul callback avec la dernière valeur", async () => {
    const cb = vi.fn();
    const unsub = store.subscribe("ui.selectedPointId", cb);
    store.set("ui.selectedPointId", "a");
    store.set("ui.selectedPointId", "b");
    store.set("ui.selectedPointId", "c");
    await new Promise(r => requestAnimationFrame(() => r()));
    await new Promise(r => setTimeout(r, 30));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe("c");
    unsub();
    store.set("ui.selectedPointId", null);
  });

  it("des chemins différents sont tous notifiés", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const u1 = store.subscribe("ui.error", a);
    const u2 = store.subscribe("ui.loading", b);
    store.set("ui.error", "x");
    store.set("ui.loading", true);
    await new Promise(r => setTimeout(r, 30));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    u1(); u2();
  });
});
