import { describe, it, expect, vi, afterEach } from "vitest";
import { enableNavigationWakeLock, disableNavigationWakeLock } from "../core/wakeLock.js";

function stubWakeLock(requestImpl) {
  Object.defineProperty(navigator, "wakeLock", {
    value: { request: requestImpl },
    configurable: true
  });
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("wakeLock", () => {
  afterEach(() => {
    disableNavigationWakeLock();
    Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
  });

  it("ne fait rien si l'API Wake Lock est absente", async () => {
    Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
    expect(() => enableNavigationWakeLock()).not.toThrow();
    await flushMicrotasks();
  });

  it("demande un verrou d'écran à l'activation", async () => {
    const request = vi.fn().mockResolvedValue({ addEventListener: vi.fn(), release: vi.fn().mockResolvedValue(undefined) });
    stubWakeLock(request);

    enableNavigationWakeLock();
    await flushMicrotasks();

    expect(request).toHaveBeenCalledWith("screen");
  });

  it("relâche le verrou à la désactivation", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ addEventListener: vi.fn(), release });
    stubWakeLock(request);

    enableNavigationWakeLock();
    await flushMicrotasks();
    disableNavigationWakeLock();

    expect(release).toHaveBeenCalled();
  });

  it("ne lève pas si la demande de verrou est refusée", async () => {
    const request = vi.fn().mockRejectedValue(new Error("refusé"));
    stubWakeLock(request);

    expect(() => enableNavigationWakeLock()).not.toThrow();
    await flushMicrotasks();
  });

  it("re-demande le verrou quand l'onglet redevient visible après un relâchement automatique", async () => {
    let releaseCallback = null;
    const addEventListener = vi.fn((event, cb) => {
      if (event === "release") releaseCallback = cb;
    });
    const request = vi.fn().mockResolvedValue({ addEventListener, release: vi.fn().mockResolvedValue(undefined) });
    stubWakeLock(request);

    enableNavigationWakeLock();
    await flushMicrotasks();
    expect(request).toHaveBeenCalledTimes(1);

    // Simule le relâchement automatique par le navigateur (ex: perte de
    // visibilité) : le sentinel interne redevient null via ce callback.
    releaseCallback?.();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();

    expect(request).toHaveBeenCalledTimes(2);
  });
});
