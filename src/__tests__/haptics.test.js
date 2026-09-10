import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { haptic, HAPTIC_PATTERNS } from "../core/haptics.js";

describe("haptic", () => {
  let vibrateSpy;

  beforeEach(() => {
    vibrateSpy = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate: vibrateSpy });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mappe un nom de motif vers sa séquence", () => {
    haptic("success");
    expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.success);
    haptic("blocked");
    expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_PATTERNS.blocked);
  });

  it("accepte une durée ou une séquence brute", () => {
    haptic(50);
    expect(vibrateSpy).toHaveBeenLastCalledWith(50);
    haptic([10, 20, 10]);
    expect(vibrateSpy).toHaveBeenLastCalledWith([10, 20, 10]);
  });

  it("motif inconnu -> aucune vibration", () => {
    expect(haptic("pas-un-motif")).toBe(false);
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it("ne jette jamais si navigator.vibrate est absent", () => {
    vi.stubGlobal("navigator", {});
    expect(() => haptic("success")).not.toThrow();
    expect(haptic("success")).toBe(false);
  });

  it("ne jette jamais si navigator.vibrate lève une exception", () => {
    vi.stubGlobal("navigator", { vibrate: () => { throw new Error("blocked by browser"); } });
    expect(haptic("error")).toBe(false);
  });
});
