import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initInstallPrompt, maybeShowInstallPrompt } from "../core/installPrompt.js";

const DISMISS_KEY = "censgo.install-prompt-dismissed-at";

function fireBeforeInstallPrompt() {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = vi.fn();
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(event);
  return event;
}

function getBanner() {
  return document.getElementById("install-banner");
}

describe("installPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(DISMISS_KEY);
    getBanner()?.remove();
    Object.defineProperty(window, "matchMedia", {
      value: () => ({ matches: false }),
      configurable: true
    });
  });

  afterEach(() => {
    getBanner()?.remove();
    vi.useRealTimers();
  });

  it("n'affiche rien si aucun événement beforeinstallprompt n'a été capté", () => {
    initInstallPrompt();
    maybeShowInstallPrompt();
    vi.advanceTimersByTime(10000);
    expect(getBanner()).toBeNull();
  });

  it("affiche le bandeau après le délai une fois l'événement capté", () => {
    initInstallPrompt();
    fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    expect(getBanner()).toBeNull(); // pas encore, avant le délai

    vi.advanceTimersByTime(4000);
    expect(getBanner()).not.toBeNull();
  });

  it("n'affiche pas le bandeau en mode déjà installé (standalone)", () => {
    Object.defineProperty(window, "matchMedia", {
      value: () => ({ matches: true }),
      configurable: true
    });
    initInstallPrompt();
    fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    vi.advanceTimersByTime(10000);
    expect(getBanner()).toBeNull();
  });

  it("n'affiche pas le bandeau si récemment refusé", () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    initInstallPrompt();
    fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    vi.advanceTimersByTime(10000);
    expect(getBanner()).toBeNull();
  });

  it("déclenche le prompt natif au clic sur Installer", async () => {
    initInstallPrompt();
    const event = fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    vi.advanceTimersByTime(4000);

    const installBtn = getBanner().querySelector("button");
    installBtn.click();
    await Promise.resolve();

    expect(event.prompt).toHaveBeenCalled();
    expect(getBanner()).toBeNull();
  });

  it("mémorise le refus et masque le bandeau au clic sur ✕", () => {
    initInstallPrompt();
    fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    vi.advanceTimersByTime(4000);

    const dismissBtn = getBanner().querySelectorAll("button")[1];
    dismissBtn.click();

    expect(getBanner()).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
  });

  it("masque le bandeau sur l'événement appinstalled", () => {
    initInstallPrompt();
    fireBeforeInstallPrompt();

    maybeShowInstallPrompt();
    vi.advanceTimersByTime(4000);
    expect(getBanner()).not.toBeNull();

    window.dispatchEvent(new Event("appinstalled"));
    expect(getBanner()).toBeNull();
  });
});
