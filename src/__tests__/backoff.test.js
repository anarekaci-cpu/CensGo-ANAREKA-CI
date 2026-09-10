import { describe, it, expect } from "vitest";
import {
  backoffDelayMs,
  nextRetryAtIso,
  isRetryDue,
  BACKOFF_CAP_MS,
  BACKOFF_BASE_MS
} from "../core/backoff.js";

describe("backoffDelayMs", () => {
  // random=() => 0 : supprime le jitter pour asserter la composante déterministe.
  const noJitter = { random: () => 0 };

  it("croît exponentiellement : 1s, 2s, 4s, 8s…", () => {
    expect(backoffDelayMs(1, noJitter)).toBe(1000);
    expect(backoffDelayMs(2, noJitter)).toBe(2000);
    expect(backoffDelayMs(3, noJitter)).toBe(4000);
    expect(backoffDelayMs(4, noJitter)).toBe(8000);
  });

  it("plafonne à BACKOFF_CAP_MS", () => {
    expect(backoffDelayMs(50, noJitter)).toBe(BACKOFF_CAP_MS);
    expect(backoffDelayMs(1000, noJitter)).toBe(BACKOFF_CAP_MS);
  });

  it("n'explose jamais en Infinity pour un attempts aberrant", () => {
    expect(Number.isFinite(backoffDelayMs(1e6, noJitter))).toBe(true);
  });

  it("ajoute un jitter additif borné (0 à +25 % par défaut)", () => {
    const base = backoffDelayMs(3, noJitter); // 4000
    const max = backoffDelayMs(3, { random: () => 1 }); // 4000 + 25 %
    expect(max).toBe(Math.round(base * 1.25));
    // 200 tirages réels : toujours dans [base, base*1.25].
    for (let i = 0; i < 200; i++) {
      const d = backoffDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThanOrEqual(max);
    }
  });

  it("traite attempts < 1 comme 1 (premier réessai)", () => {
    expect(backoffDelayMs(0, noJitter)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(-5, noJitter)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(undefined, noJitter)).toBe(BACKOFF_BASE_MS);
  });
});

describe("nextRetryAtIso", () => {
  it("renvoie une date ISO future cohérente avec le délai", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const iso = nextRetryAtIso(2, now, { random: () => 0 });
    expect(iso).toBe("2026-01-01T00:00:02.000Z");
  });
});

describe("isRetryDue", () => {
  const now = 1_000_000;

  it("dû si nextRetryAt absent (jamais échoué / champ hérité manquant)", () => {
    expect(isRetryDue({}, now)).toBe(true);
    expect(isRetryDue({ nextRetryAt: null }, now)).toBe(true);
    expect(isRetryDue(undefined, now)).toBe(true);
  });

  it("pas dû tant que l'échéance est dans le futur", () => {
    expect(isRetryDue({ nextRetryAt: new Date(now + 5000).toISOString() }, now)).toBe(false);
  });

  it("dû dès que l'échéance est passée", () => {
    expect(isRetryDue({ nextRetryAt: new Date(now - 1).toISOString() }, now)).toBe(true);
  });

  it("dû (fail-open) si nextRetryAt est illisible — ne bloque jamais un item pour toujours", () => {
    expect(isRetryDue({ nextRetryAt: "pas-une-date" }, now)).toBe(true);
  });
});
