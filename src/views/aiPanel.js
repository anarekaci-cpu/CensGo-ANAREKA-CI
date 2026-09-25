// Panneau « Agents IA » (extrait de appView.js).
import { store } from "../core/store.js";
import { toastWarning } from "../core/toast.js";
import { escapeHtml } from "../core/utils.js";
import { lazyImport } from "../core/lazyImport.js";
import { extractExifGps } from "../core/exif.js";
import { haversineKm } from "../core/geo.js";
import { closeControls } from "./uiHelpers.js";

// Distance max (m) entre la position GPS d'une photo et l'agent avant alerte.
const PHOTO_GEOTAG_WARNING_M = 500;

let aiModulePromise = null;
function getAiModule() {
  if (!aiModulePromise) aiModulePromise = lazyImport(() => import("../modules/ai/aiAgents.js"));
  return aiModulePromise;
}

/**
 * Recoupe la position GPS EXIF d'une photo sélectionnée pour l'Agent
 * Vision avec la position actuelle de l'agent — avertit (sans bloquer
 * l'analyse) si elles sont éloignées, signe probable d'une photo choisie
 * dans la galerie plutôt que prise à l'instant sur le terrain.
 *
 * Best-effort à tous les niveaux : pas de position GPS actuelle, pas de
 * métadonnées EXIF sur la photo (fréquent — beaucoup d'apps photo les
 * retirent), ou erreur de lecture -> silence complet, jamais de blocage.
 */
export async function checkPhotoGeotag(file) {
  try {
    const currentPos = store.get("geo.position");
    if (!currentPos) return;

    const buffer = await file.arrayBuffer();
    const gps = extractExifGps(buffer);
    if (!gps) return;

    const distKm = haversineKm(currentPos.lat, currentPos.lng, gps.lat, gps.lon);
    if (distKm * 1000 > PHOTO_GEOTAG_WARNING_M) {
      const distLabel = distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`;
      toastWarning(`📍 Cette photo a été prise à ${distLabel} de votre position actuelle — vérifiez qu'il s'agit bien d'une photo prise ici, à l'instant.`);
    }
  } catch {
    // Parsing EXIF best-effort — ne doit jamais empêcher l'analyse de la photo.
  }
}

export function bindAiEvents() {
  const openModal = () => {
    document.getElementById("aiModal").style.display = "block";
    closeControls();
  };
  const closeModal = () => {
    document.getElementById("aiModal").style.display = "none";
  };

  document.getElementById("aiModalBtnHeader")?.addEventListener("click", openModal);
  document.getElementById("aiModalBtnControl")?.addEventListener("click", openModal);
  document.getElementById("aiModalCloseBtn")?.addEventListener("click", closeModal);
  document.getElementById("aiModalBackdrop")?.addEventListener("click", closeModal);

  const tabs = document.querySelectorAll(".ai-tab");
  tabs.forEach(t => {
    t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const tabName = t.dataset.tab;
      document.getElementById("aiTabCopilot").style.display = tabName === "copilot" ? "block" : "none";
      document.getElementById("aiTabStrategist").style.display = tabName === "strategist" ? "block" : "none";
      document.getElementById("aiTabVoice").style.display = tabName === "voice" ? "block" : "none";
      document.getElementById("aiTabVision").style.display = tabName === "vision" ? "block" : "none";
      document.getElementById("aiTabBriefing").style.display = tabName === "briefing" ? "block" : "none";
    });
  });

  const displayOutput = (html) => {
    const box = document.getElementById("aiAgentOutput");
    const text = document.getElementById("aiOutputText");
    if (box) box.style.display = "block";
    if (text) text.innerHTML = html;
  };

  const formatAiText = (str) => {
    return (str || "")
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');
  };

  const runCopilot = async (prompt) => {
    if (!prompt || !prompt.trim()) return;
    displayOutput("⏳ <i>L'Agent Copilot IA réfléchit...</i>");
    try {
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await (await getAiModule()).askAiAgent("copilot", { prompt, points, userPos });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Impossible de contacter l'agent IA")}</i>`);
    }
  };

  document.getElementById("aiCopilotSendBtn")?.addEventListener("click", () => {
    const input = document.getElementById("aiCopilotInput");
    if (input) {
      runCopilot(input.value);
      input.value = "";
    }
  });

  document.getElementById("aiCopilotInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const input = document.getElementById("aiCopilotInput");
      if (input) {
        runCopilot(input.value);
        input.value = "";
      }
    }
  });

  document.querySelectorAll(".chip-prompt").forEach(btn => {
    btn.addEventListener("click", () => {
      runCopilot(btn.dataset.prompt);
    });
  });

  document.getElementById("aiRunStrategistBtn")?.addEventListener("click", async () => {
    displayOutput("⏳ <i>L'Agent Strategist analyse votre secteur...</i>");
    try {
      const points = store.get("points") || [];
      const userPos = store.get("geo.position");
      const res = await (await getAiModule()).askAiAgent("optimize_tour", { points, userPos });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse")}</i>`);
    }
  });

  document.getElementById("aiRunAuditBtn")?.addEventListener("click", async () => {
    displayOutput("⏳ <i>L'Agent Audit vérifie la qualité des données...</i>");
    try {
      const points = store.get("points") || [];
      const res = await (await getAiModule()).askAiAgent("audit_quality", { points });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'audit")}</i>`);
    }
  });

  let recognizer = null;
  const micBtn = document.getElementById("aiMicBtn");
  const micStatus = document.getElementById("aiMicStatus");
  const voiceText = document.getElementById("aiVoiceNoteText");

  if (micBtn) {
    micBtn.addEventListener("click", async () => {
      if (!recognizer) {
        const { createSpeechRecognizer } = await getAiModule();
        recognizer = createSpeechRecognizer(
          (transcript) => {
            if (voiceText) voiceText.value = (voiceText.value ? voiceText.value + " " : "") + transcript;
            if (micStatus) micStatus.textContent = "✅ Transcrit !";
            if (micBtn) micBtn.classList.remove("recording");
          },
          (err) => {
            console.warn("Erreur dictée vocale:", err);
            if (micStatus) micStatus.textContent = "⚠️ Dictée vocale non disponible sur ce navigateur";
            if (micBtn) micBtn.classList.remove("recording");
          },
          () => {
            if (micBtn) micBtn.classList.remove("recording");
          }
        );
      }

      if (recognizer) {
        try {
          recognizer.start();
          if (micStatus) micStatus.textContent = "🔴 Écoute en cours... Parlez !";
          micBtn.classList.add("recording");
        } catch (e) {
          console.warn(e);
        }
      } else {
        if (micStatus) micStatus.textContent = "⚠️ Saisissez directement le texte ci-dessous.";
      }
    });
  }

  document.getElementById("aiParseVoiceBtn")?.addEventListener("click", async () => {
    const prompt = voiceText?.value;
    if (!prompt || !prompt.trim()) {
      toastWarning("Veuillez d'abord dicter ou taper une note vocale.");
      return;
    }
    displayOutput("⏳ <i>L'Agent Transcripteur IA analyse et extrait les données...</i>");
    try {
      const res = await (await getAiModule()).askAiAgent("parse_voice_note", { prompt });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse vocale")}</i>`);
    }
  });

  let currentImageBase64 = null;
  let currentMimeType = "image/jpeg";
  const selectImgBtn = document.getElementById("aiSelectImageBtn");
  const fileInput = document.getElementById("aiImageInput");
  const imgPreview = document.getElementById("aiImagePreview");
  const runVisionBtn = document.getElementById("aiRunVisionBtn");

  selectImgBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      currentMimeType = file.type || "image/jpeg";
      const reader = new FileReader();
      reader.onload = (evt) => {
        currentImageBase64 = evt.target.result;
        if (imgPreview) {
          imgPreview.style.display = "block";
          imgPreview.innerHTML = `<img src="${currentImageBase64}" alt="Aperçu de la photo sélectionnée" style="max-width:100%; max-height:180px; border-radius:10px; margin-top:8px; border:1px solid #ddd;" />`;
        }
        if (runVisionBtn) runVisionBtn.style.display = "block";
      };
      reader.readAsDataURL(file);
      checkPhotoGeotag(file);
    }
  });

  runVisionBtn?.addEventListener("click", async () => {
    if (!currentImageBase64) return;
    displayOutput("⏳ <i>L'Agent Vision Reconnaissance Gemini analyse la photo...</i>");
    try {
      const res = await (await getAiModule()).askAiAgent("vision_ocr", { imageBase64: currentImageBase64, mimeType: currentMimeType });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec de l'analyse photo")}</i>`);
    }
  });

  document.getElementById("aiRunBriefingBtn")?.addEventListener("click", async () => {
    displayOutput("⏳ <i>Préparation de votre Briefing IA Matinal...</i>");
    try {
      const points = store.get("points") || [];
      const res = await (await getAiModule()).askAiAgent("daily_briefing", { points });
      displayOutput(formatAiText(res.text));
    } catch (e) {
      displayOutput(`❌ <i>Erreur : ${escapeHtml(e.message || "Échec du briefing")}</i>`);
    }
  });
}

