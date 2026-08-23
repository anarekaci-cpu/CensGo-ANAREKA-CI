/**
 * Guidage vocal (Web Speech API SpeechSynthesis) — annonce les instructions
 * de navigation à voix haute pour un usage mains-libres (téléphone en
 * poche pendant la marche/vélo/véhicule).
 *
 * Activé par défaut, désactivable via le bouton 🔊/🔇 du panneau de
 * navigation ; la préférence est mémorisée (localStorage) pour les
 * sessions suivantes.
 */

const STORAGE_KEY = "anareka.speechEnabled";

// Emoji utilisés dans les instructions (formatManeuverInstruction, bannières
// d'arrivée...) — beaucoup de moteurs TTS les épellent ("visage souriant")
// au lieu de les ignorer, ce qui rend l'annonce incompréhensible.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu;

function readEnabledPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

let enabled = readEnabledPreference();

export function isSpeechEnabled() {
  return enabled;
}

export function setSpeechEnabled(value) {
  enabled = !!value;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Stockage indisponible (navigation privée...) — la préférence ne
    // survivra pas à la session, sans conséquence fonctionnelle.
  }
  if (!enabled) {
    cancelSpeech();
  }
}

function getSynth() {
  return typeof window !== "undefined" ? window.speechSynthesis : null;
}

export function cancelSpeech() {
  const synth = getSynth();
  if (synth) synth.cancel();
}

/**
 * Annonce `text` à voix haute. Sans effet si le guidage vocal est
 * désactivé, si le texte est vide, ou si l'API n'est pas supportée par le
 * navigateur (pas d'erreur — simple no-op silencieux).
 */
export function speak(text) {
  if (!enabled || !text) return;

  const synth = getSynth();
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;

  const clean = text.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  if (!clean) return;

  try {
    // Ne pas empiler les annonces : la plus récente prime toujours sur une
    // instruction déjà obsolète (l'agent a pu avancer entre-temps).
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "fr-FR";
    utterance.rate = 1.0;
    synth.speak(utterance);
  } catch {
    // API bloquée par le navigateur (permissions, contexte non interactif) —
    // le guidage textuel existant reste disponible, pas de dégradation
    // fonctionnelle au-delà de l'absence de voix.
  }
}
