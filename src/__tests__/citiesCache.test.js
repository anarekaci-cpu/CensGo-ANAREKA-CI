import { describe, it, expect, vi, beforeEach } from "vitest";

const supabaseResult = { data: null, error: null };
vi.mock("../core/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: () => ({ select: () => ({ order: async () => supabaseResult }) })
  })
}));

const { loadCities, getCachedCities } = await import("../core/cities.js");

describe("villes — cache hors connexion", () => {
  beforeEach(() => {
    localStorage.clear();
    supabaseResult.data = null;
    supabaseResult.error = null;
  });

  it("met en cache la liste reçue du serveur", async () => {
    supabaseResult.data = [{ id: "1", name: "Bingerville" }];
    expect(await loadCities()).toEqual([{ id: "1", name: "Bingerville" }]);
    expect(getCachedCities()).toEqual([{ id: "1", name: "Bingerville" }]);
  });

  it("hors connexion : renvoie la dernière liste connue au lieu d'une liste vide", async () => {
    supabaseResult.data = [{ id: "1", name: "Bingerville" }];
    await loadCities();
    supabaseResult.data = null;
    supabaseResult.error = new Error("Failed to fetch");
    expect(await loadCities()).toEqual([{ id: "1", name: "Bingerville" }]);
  });

  it("cache corrompu : ignoré sans planter", async () => {
    localStorage.setItem("censgo.cities.v1", "{pas du json");
    supabaseResult.error = new Error("offline");
    expect(await loadCities()).toEqual([]);
  });
});
