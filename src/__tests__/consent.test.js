import { describe, it, expect } from "vitest";
import { buildConsentFields, hasConsent, consentToDb, consentFromRaw, consentScript, CONSENT_VERSION } from "../core/consent.js";

describe("consentement (loi 2013-450)", () => {
  const now = new Date("2026-09-25T10:00:00Z");

  it("trace quand, comment, par qui et sur quelle version du texte", () => {
    expect(buildConsentFields({ method: "ecrit", userId: "u1", now })).toEqual({
      consentGiven: true, consentAt: "2026-09-25T10:00:00.000Z", consentMethod: "ecrit", consentBy: "u1", consentVersion: CONSENT_VERSION
    });
  });

  it("méthode inconnue ramenée à 'oral'", () => {
    expect(buildConsentFields({ method: "sms", userId: null, now }).consentMethod).toBe("oral");
  });

  it("n'envoie rien pour une fiche sans consentement (pas d'écrasement par NULL)", () => {
    expect(consentToDb({ name: "x" })).toEqual({});
    expect(consentToDb({ consentGiven: true })).toEqual({}); // non daté => invalide
  });

  it("aller-retour app -> Supabase -> app", () => {
    const point = buildConsentFields({ method: "oral", userId: "u1", now });
    const db = consentToDb(point);
    expect(db.consent_at).toBe(point.consentAt);
    expect(consentFromRaw(db)).toEqual(point);
    expect(hasConsent(consentFromRaw(db))).toBe(true);
  });

  it("le texte lu cite l'association, les données, et les droits", () => {
    const text = consentScript().join(" ");
    expect(text).toMatch(/ANAREKA-CI/);
    expect(text).toMatch(/téléphone/);
    expect(text).toMatch(/consulter, les corriger ou les supprimer/);
    expect(text).toMatch(/Acceptez-vous/);
  });
});
