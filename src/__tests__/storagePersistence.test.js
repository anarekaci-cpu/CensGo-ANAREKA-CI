import { describe, it, expect, afterEach } from "vitest";
import { requestPersistentStorage } from "../core/storagePersistence.js";

function stubStorage(value) {
  Object.defineProperty(navigator, "storage", { value, configurable: true });
}

describe("requestPersistentStorage", () => {
  afterEach(() => {
    stubStorage(undefined);
  });

  it("retourne null si l'API navigator.storage.persist est absente", async () => {
    stubStorage(undefined);
    await expect(requestPersistentStorage()).resolves.toBeNull();
  });

  it("retourne true sans redemander si déjà persistant", async () => {
    let persistCalled = false;
    stubStorage({
      persisted: async () => true,
      persist: async () => { persistCalled = true; return true; }
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persistCalled).toBe(false);
  });

  it("demande et retourne le résultat accordé par le navigateur", async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => true
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
  });

  it("retourne false si le navigateur refuse", async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => false
    });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it("retourne null au lieu de lever si l'API échoue", async () => {
    stubStorage({
      persisted: async () => { throw new Error("boom"); },
      persist: async () => true
    });
    await expect(requestPersistentStorage()).resolves.toBeNull();
  });
});
