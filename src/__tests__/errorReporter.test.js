import { describe, it, expect, beforeEach, vi } from "vitest";
import { scrub, fingerprint, buildEntry, reportError, flushErrors, initErrorReporter } from "../core/errorReporter.js";

describe("errorReporter — nettoyage des données personnelles", () => {
  it("masque e-mails, numéros ivoiriens et jetons JWT", () => {
    const out = scrub("échec pour awa.kone@example.ci tel 07 08 09 10 11 / +225 0102030405 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc");
    expect(out).not.toMatch(/awa\.kone|07 08 09|0102030405|eyJhbGci/);
    expect(out).toContain("[email]");
    expect(out).toContain("[tel]");
  });

  it("ne touche pas aux numéros de ligne de la pile", () => {
    expect(scrub("at f (app.js:12:7394)")).toBe("at f (app.js:12:7394)");
  });
});

describe("errorReporter — empreinte", () => {
  it("identique pour la même erreur à des colonnes différentes", () => {
    const a = fingerprint("x is undefined", "Error\n    at render (appView.js:10:5)");
    const b = fingerprint("x is undefined", "Error\n    at render (appView.js:10:99)");
    expect(a).toBe(b);
  });
  it("différente pour deux messages différents", () => {
    expect(fingerprint("a", "")).not.toBe(fingerprint("b", ""));
  });
});

describe("errorReporter — file et envoi", () => {
  let inserted;
  let session;
  const client = () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: () => ({ insert: async (rows) => { inserted.push(...rows); return { error: null }; } })
  });

  beforeEach(() => {
    localStorage.clear();
    inserted = [];
    session = { user: { id: "u1" } };
    initErrorReporter({ enabled: true, getSupabaseClient: client, version: "test" });
  });

  it("dédoublonne la même erreur en comptant les occurrences", async () => {
    const err = new Error("boom");
    reportError(err);
    reportError(err);
    await flushErrors();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].occurrences).toBe(2);
    expect(inserted[0].app_version).toBe("test");
  });

  it("garde la file tant que l'utilisateur n'est pas connecté", async () => {
    session = null;
    reportError(new Error("avant connexion"));
    await flushErrors();
    expect(inserted).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("censgo.errorQueue.v1"))).toHaveLength(1);
  });

  it("l'entrée ne contient pas la query string de l'URL", () => {
    const entry = buildEntry(new Error("x"));
    expect(entry.page).not.toContain("?");
  });

  it("n'échoue jamais même si le client Supabase plante", async () => {
    initErrorReporter({ enabled: true, getSupabaseClient: () => { throw new Error("pas de client"); } });
    reportError(new Error("y"));
    await expect(flushErrors()).resolves.toBeUndefined();
  });
});

describe("errorReporter — désactivé", () => {
  it("n'enregistre rien quand le flag est à false", () => {
    localStorage.clear();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    initErrorReporter({ enabled: false });
    reportError(new Error("z"));
    expect(spy).not.toHaveBeenCalledWith("censgo.errorQueue.v1", expect.anything());
    spy.mockRestore();
  });
});
