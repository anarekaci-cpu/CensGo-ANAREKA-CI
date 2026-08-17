import { store } from "../../core/store.js";

/**
 * Service pour interagir avec les Agents IA ANAREKA-CI
 */

export async function askAiAgent(action, { prompt, points, userPos, imageBase64, mimeType } = {}) {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, prompt, points, userPos, imageBase64, mimeType })
    });

    if (!res.ok) {
      throw new Error(`Erreur serveur (${res.status})`);
    }

    const data = await res.json();
    if (data.success && data.result) {
      return { success: true, text: data.result };
    }

    if (data.fallback) {
      console.info("Clé Gemini non configurée — mode analyse locale activé");
    }

    return generateFallbackAgentResponse(action, { prompt, points, userPos, imageBase64 });
  } catch (err) {
    console.warn("API IA indisponible, réponse locale :", err.message);
    return generateFallbackAgentResponse(action, { prompt, points, userPos, imageBase64 });
  }
}

/**
 * Helper Reconnaissance Vocale HTML5 (Web Speech API)
 */
export function createSpeechRecognizer(onResult, onError, onEnd) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return null;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "fr-FR";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (onResult) onResult(transcript);
  };

  recognition.onerror = (err) => {
    if (onError) onError(err);
  };

  recognition.onend = () => {
    if (onEnd) onEnd();
  };

  return recognition;
}

/**
 * Générateur local intelligent en mode secours (Offline / No Key)
 */
function generateFallbackAgentResponse(action, { prompt, points }) {
  const allPoints = points || store.get("points") || [];
  const unvisited = allPoints.filter(p => !p.visited);
  const injoignables = allPoints.filter(p => p.status?.includes("JAUNE"));
  const aVerifier = allPoints.filter(p => p.status?.includes("VIOLET"));

  // Quartier le plus représenté dans les données déjà recensées — remplace un
  // nom de quartier figé (utile seulement pour Bingerville) par une vraie
  // lecture de la couverture actuelle, où que les agents travaillent en CI.
  const quartierCounts = new Map();
  allPoints.forEach(p => { if (p.quartier) quartierCounts.set(p.quartier, (quartierCounts.get(p.quartier) || 0) + 1); });
  const topQuartier = [...quartierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const leastCoveredQuartier = [...quartierCounts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];

  if (action === "optimize_tour") {
    return {
      success: true,
      text: `🤖 **Agent Strategist ANAREKA-CI** :\n\n` +
            `📍 **Statut du secteur** : ${unvisited.length} établissements restants sur ${allPoints.length}.\n\n` +
            `1. **Recommandation Horaires** : Commencez par *${unvisited[0]?.quartier || topQuartier || 'votre zone actuelle'}* (concentration élevée de restaurateurs/kiosques à recenser).\n` +
            `2. **Points d'Urgence** : Priorisez les ${injoignables.length} établissement(s) injoignable(s) en fin de matinée (entre 11h30 et 13h, hors coup de feu du service).\n` +
            `3. **Efficacité de tournée** : Regroupez vos passages par quartier pour minimiser vos déplacements entre kiosques.`
    };
  }

  if (action === "audit_quality") {
    const missingPhone = allPoints.filter(p => !p.tel || p.tel === "");
    const missingAddress = allPoints.filter(p => !p.address || p.address === "");
    const missingActivity = allPoints.filter(p => !p.activityType);

    return {
      success: true,
      text: `🔍 **Agent Inspecteur Qualité Données** :\n\n` +
            `📊 **Rapport d'audit de la base** (${allPoints.length} fiches) :\n\n` +
            `• ⚠️ **Numéros manquants** : ${missingPhone.length} fiche(s) sans contact renseigné.\n` +
            `• 📍 **Emplacements imprécis** : ${missingAddress.length} fiche(s) nécessitent un repère plus précis.\n` +
            `• 🏪 **Type d'activité manquant** : ${missingActivity.length} fiche(s) sans Kiosque/Restaurant/Vendeur/Producteur renseigné.\n` +
            `• ❓ **Statuts "À vérifier" (Violet)** : ${aVerifier.length} fiche(s) doivent faire l'objet d'un second passage.\n\n` +
            `💡 *Conseil : Complétez les données dès que vous êtes sur place avant de valider la visite.*`
    };
  }

  if (action === "daily_briefing") {
    const total = allPoints.length;
    const visited = total - unvisited.length;
    const pct = Math.round((visited / (total || 1)) * 100);

    return {
      success: true,
      text: `📋 **Briefing IA Matinal — ANAREKA-CI** :\n\n` +
            `🌤️ **Terrain** : Zone d'intervention prioritaire aujourd'hui : ${leastCoveredQuartier ? `*${leastCoveredQuartier}* (couverture la plus faible)` : 'à définir selon votre secteur'}.\n` +
            `🎯 **Objectif du jour** : Atteindre **${Math.min(total, visited + 8)} fiches validées** (+${Math.min(8, unvisited.length)} aujourd'hui).\n` +
            `📊 **Progression Actuelle** : **${pct}%** (${visited}/${total} restaurateurs/kiosques recensés).\n\n` +
            `⚡ **Action recommandée** : Activez la tournée optimisée pour enchaîner les établissements les plus proches sans détours.`
    };
  }

  if (action === "parse_voice_note") {
    // Essayer de deviner un tel ou nom dans le prompt
    const phoneMatch = (prompt || "").match(/(?:0[175])\d{8}/) || (prompt || "").match(/\d{10}/);
    const tel = phoneMatch ? phoneMatch[0] : "";
    const isVisited = !(prompt || "").toLowerCase().includes("non") && !(prompt || "").toLowerCase().includes("absent");
    const status = (prompt || "").toLowerCase().includes("injoignable") ? "Jaune — Injoignable" : (isVisited ? "Vert — Validé" : "Rouge — Refus / Inaccessible");

    return {
      success: true,
      text: `🎙️ **Agent Transcripteur IA** :\n\n` +
            `Analyse de la note vocale terrain : *"${prompt || 'Rien à signaler'}"*\n\n` +
            `• **Statut détecté** : ${status}\n` +
            `• **Contact extrait** : ${tel || 'Non spécifié'}\n` +
            `• **Action** : Fiche prête à être mise à jour avec statut visité = ${isVisited ? 'Oui' : 'Non'}.`
    };
  }

  if (action === "vision_ocr") {
    return {
      success: true,
      text: `📸 **Agent Vision** :\n\n` +
            `⚠️ *Analyse photo indisponible* — la clé API Gemini n'est pas configurée sur ce serveur.\n\n` +
            `Pour activer l'analyse photo, ajoutez \`GEMINI_API_KEY\` dans le fichier \`.env\` du serveur.\n\n` +
            `En attendant, relevez manuellement le nom de l'enseigne et le type d'activité depuis la photo.`
    };
  }

  // Action Copilot par défaut
  const q = (prompt || "").toLowerCase();
  let reply = "";

  if (q.includes("priorité") || q.includes("priorite") || q.includes("quoi faire")) {
    reply = `🎯 **Priorités du jour** :\n\nVous avez **${unvisited.length} établissement(s)** à recenser aujourd'hui.${topQuartier ? ` Concentrez-vous d'abord sur *${topQuartier}*.` : ''}`;
  } else if (q.includes("synthèse") || q.includes("synthese") || q.includes("rapport")) {
    const visited = allPoints.filter(p => p.visited).length;
    const pct = Math.round((visited / (allPoints.length || 1)) * 100);
    reply = `📊 **Synthèse du Recensement ANAREKA-CI** :\n\nProgression globale : **${pct}%** (${visited}/${allPoints.length} restaurateurs/kiosques recensés).\nStatuts à relancer : ${injoignables.length} injoignables, ${aVerifier.length} à vérifier.`;
  } else {
    reply = `🤖 **Agent Copilot Terrain** :\n\nJ'ai analysé votre requête (*"${prompt}"*).\nIl vous reste ${unvisited.length} établissement(s) à recenser. N'hésitez pas à utiliser la dictée vocale ou la tournée optimisée !`;
  }

  return { success: true, text: reply };
}
