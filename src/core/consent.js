// Consentement de la personne recensée — loi ivoirienne n° 2013-450 du
// 19 juin 2013 relative à la protection des données à caractère personnel
// (autorité : ARTCI). Principe : information préalable (qui collecte, quoi,
// pourquoi, droits) + accord explicite, tracé (quand, comment, par quel agent,
// sur quelle version du texte).
//
// Activé par VITE_ENABLE_CONSENT=true APRÈS supabase/add_consent.sql.

import { CONFIG } from "./config.js";

/** À incrémenter à chaque modification du texte ci-dessous. */
export const CONSENT_VERSION = "2026-09-v1";

export const CONSENT_METHODS = { oral: "Oral", ecrit: "Écrit (signature)" };

/**
 * Texte que l'agent lit à la personne AVANT de saisir ses informations.
 * ⚠️ À faire valider par le bureau de l'ANAREKA-CI (durée de conservation,
 * contact) avant activation.
 */
export function consentScript() {
  const contact = CONFIG.CONSENT_CONTACT
    ? ` au ${CONFIG.CONSENT_CONTACT}`
    : " auprès de l'association";
  return [
    "Je suis agent de recensement de l'ANAREKA-CI, l'Association Nationale des Restaurateurs et Kiosques d'Attiéké de Côte d'Ivoire.",
    "Nous recensons les restaurateurs et vendeurs d'attiéké pour mieux vous représenter et vous informer des activités de l'association.",
    "J'enregistre votre nom, votre téléphone, votre activité, l'emplacement et une photo de votre établissement.",
    "Ces informations restent à l'ANAREKA-CI : elles ne sont ni vendues ni publiées.",
    `Vous pouvez à tout moment demander à les consulter, les corriger ou les supprimer${contact}.`,
    "Acceptez-vous d'être recensé(e) ?"
  ];
}

/**
 * Champs de consentement à enregistrer avec la fiche.
 * @param {{ method: string, userId: string|null, now?: Date }} p
 */
export function buildConsentFields({ method, userId, now = new Date() }) {
  return {
    consentGiven: true,
    consentAt: now.toISOString(),
    consentMethod: method in CONSENT_METHODS ? method : "oral",
    consentBy: userId || null,
    consentVersion: CONSENT_VERSION
  };
}

/** Une fiche porte-t-elle déjà un consentement valide ? */
export function hasConsent(point) {
  return point?.consentGiven === true && !!point?.consentAt;
}

/**
 * Colonnes Supabase à envoyer. Vide si la fiche n'a pas de consentement
 * enregistré : une modification d'une fiche ancienne ne doit pas écraser
 * les colonnes avec des NULL.
 */
export function consentToDb(point) {
  if (!hasConsent(point)) return {};
  return {
    consent_given: true,
    consent_at: point.consentAt,
    consent_method: point.consentMethod || "oral",
    consent_by: point.consentBy || null,
    consent_version: point.consentVersion || null
  };
}

/** Lecture depuis une ligne Supabase ou IndexedDB (snake_case ou camelCase). */
export function consentFromRaw(raw) {
  const given = raw?.consentGiven ?? raw?.consent_given;
  const at = raw?.consentAt ?? raw?.consent_at;
  if (given !== true || !at) return {};
  return {
    consentGiven: true,
    consentAt: at,
    consentMethod: raw.consentMethod ?? raw.consent_method ?? "oral",
    consentBy: raw.consentBy ?? raw.consent_by ?? null,
    consentVersion: raw.consentVersion ?? raw.consent_version ?? null
  };
}

/** Colonnes à ajouter au SELECT du chargement (seulement si activé). */
export const CONSENT_COLUMNS = "consent_given,consent_at,consent_method,consent_by,consent_version";
