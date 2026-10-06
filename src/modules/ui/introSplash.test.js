import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { showIntroSplash } from "./introSplash.js";

describe("showIntroSplash", () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.className = "";
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("monte le splash puis révèle l'app et le retire", async () => {
    const p = showIntroSplash();
    expect(document.getElementById("intro-splash")).not.toBeNull();
    expect(document.body.classList.contains("app-revealed")).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    await p;
    expect(document.getElementById("intro-splash")).toBeNull();
    expect(document.body.classList.contains("app-revealed")).toBe(true);
  });

  it("ne rejoue pas l'intro dans la même session et révèle l'app aussitôt", async () => {
    sessionStorage.setItem("censgo.intro.seen", "1");
    await showIntroSplash();
    expect(document.getElementById("intro-splash")).toBeNull();
    expect(document.body.classList.contains("app-revealed")).toBe(true);
  });

  it("applique la variante sans mouvement si prefers-reduced-motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    showIntroSplash();
    expect(document.getElementById("intro-splash").classList.contains("is-reduced")).toBe(true);
  });
});
