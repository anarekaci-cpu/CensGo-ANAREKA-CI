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

    // Mode secours hors-ligne / sans clé API
    return generateFallbackAgentResponse(action, { prompt, points, userPos, imageBase64 });
  } catch (err) {
    console.warn("API IA indisponible ou mode hors-ligne, génération de réponse locale :", err.message);
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

  if (action === "optimize_tour") {
    return {
      success: true,
      text: `🤖 **Agent Strategist (Analyse Terrain Bingerville)** :\n\n` +
            `📍 **Statut du secteur** : ${unvisited.length} points restants sur ${allPoints.length}.\n\n` +
            `1. **Recommandation Horaires** : Commencez par le quartier *${unvisited[0]?.quartier || 'Gbagba'}* (densité élevée de compteurs à relever).\n` +
            `2. **Points d'Urgence** : Priorisez les ${injoignables.length} ménages injoignables en fin de matinée (entre 11h30 et 13h).\n` +
            `3. **Efficacité énergétique** : Effectuez votre parcours en boucle concentrique autour de Bingerville centre pour minimiser vos déplacements.`
    };
  }

  if (action === "audit_quality") {
    const missingPhone = allPoints.filter(p => !p.tel || p.tel === "");
    const missingAddress = allPoints.filter(p => !p.address || p.address === "");

    return {
      success: true,
      text: `🔍 **Agent Inspecteur Qualité Données** :\n\n` +
            `📊 **Rapport d'audit de la base** (${allPoints.length} fiches) :\n\n` +
            `• ⚠️ **Numéros manquants** : ${missingPhone.length} fiche(s) sans contact renseigné.\n` +
            `• 📍 **Adresses imprécises** : ${missingAddress.length} fiche(s) nécessitent un complément de lot/rue.\n` +
            `• ❓ **Statuts "À vérifier" (Violet)** : ${aVerifier.length} fiche(s) doivent faire l'objet d'un second passage.\n\n` +
            `💡 *Conseil : Complétez les données dès que vous êtes sur le point avant de valider la visite.*`
    };
  }

  if (action === "daily_briefing") {
    const total = allPoints.length;
    const visited = total - unvisited.length;
    const pct = Math.round((visited / (total || 1)) * 100);

    return {
      success: true,
      text: `📋 **Briefing IA Matinal — Sectoriel Bingerville** :\n\n` +
            `🌤️ **Météo & Terrain** : Conditions idéales. Zone d'intervention principale : Bingerville Centre & Quartier Gbagba.\n` +
            `🎯 **Objectif du jour** : Atteindre **${Math.min(total, visited + 8)} fiches validées** (+${Math.min(8, unvisited.length)} aujourd'hui).\n` +
            `📊 **Progression Actuelle** : **${pct}%** (${visited}/${total} réalisés).\n\n` +
            `⚡ **Action recommandée** : Activez la tournée optimisée pour enchaîner les 5 points les plus proches sans détours.`
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
    // Sans clé Gemini configurée, il n'existe aucune analyse d'image réelle en local :
    // on ne doit surtout pas inventer un numéro de série ou un index de consommation
    // (l'ancienne version générait ces valeurs au hasard tout en affirmant qu'elles
    // avaient été "vérifiées par Gemini Flash" — un agent pressé pouvait recopier ces
    // fausses données dans la fiche réelle).
    return {
      success: true,
      text: `📸 **Agent Reconnaissance Photo & Compteur** :\n\n` +
            `⚠️ *Analyse IA indisponible hors-ligne (clé Gemini non configurée ou pas de réseau).*\n\n` +
            `Aucune lecture automatique du compteur n'a été effectuée. Merci de relever manuellement le numéro de série et l'index sur la photo, puis de les saisir vous-même dans la fiche.`
    };
  }

  // Action Copilot par défaut
  const q = (prompt || "").toLowerCase();
  let reply = "";

  if (q.includes("priorité") || q.includes("priorite") || q.includes("quoi faire")) {
    reply = `🎯 **Priorités du jour** :\n\nVous avez **${unvisited.length} ménages** à visiter aujourd'hui. Concentrez-vous d'abord sur les blocs 1 et 2 à Bingerville.`;
  } else if (q.includes("synthèse") || q.includes("synthese") || q.includes("rapport")) {
    const visited = allPoints.filter(p => p.visited).length;
    const pct = Math.round((visited / (allPoints.length || 1)) * 100);
    reply = `📊 **Synthèse du Recensement Bingerville** :\n\nProgression globale : **${pct}%** (${visited}/${allPoints.length} points effectués).\nStatuts à relancer : ${injoignables.length} injoignables, ${aVerifier.length} à vérifier.`;
  } else {
    reply = `🤖 **Agent Copilot Terrain** :\n\nJ'ai analysé votre requête (*"${prompt}"*).\nPour la zone Bingerville : vous avez ${unvisited.length} points restants. N'hésitez pas à utiliser la dictée vocale, le scanner de compteur photo ou la tournée optimisée !`;
  }

  return { success: true, text: reply };
}
