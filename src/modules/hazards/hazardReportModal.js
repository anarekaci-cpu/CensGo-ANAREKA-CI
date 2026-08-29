// Réutilise les classes CSS déjà stylées de confirmModal.js (overlay,
// backdrop, carte) plutôt que d'en définir de nouvelles — seule la liste de
// boutons diffère (choix multiple au lieu de confirmer/annuler).
const HAZARD_TYPES = [
  { id: "flooding", label: "🌊 Inondation" },
  { id: "road_blocked", label: "🚧 Route bloquée" },
  { id: "other", label: "⚠️ Autre danger" }
];

/**
 * @returns {Promise<string|null>} id du type choisi ("flooding",
 * "road_blocked", "other"), ou null si l'agent annule.
 */
export function chooseHazardType() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Signaler un danger");
    overlay.innerHTML = `
      <div class="confirm-modal-backdrop"></div>
      <div class="confirm-modal-card">
        <div class="confirm-modal-title">Signaler un danger</div>
        <div class="confirm-modal-desc">À votre position actuelle — visible par les autres agents dès la synchronisation.</div>
        <div class="confirm-modal-actions" style="flex-direction:column; gap:8px;">
          ${HAZARD_TYPES.map(t => `<button type="button" class="confirm-primary hazard-type-btn" data-type="${t.id}" style="width:100%;">${t.label}</button>`).join("")}
          <button type="button" class="confirm-cancel" style="width:100%;">Annuler</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelectorAll(".hazard-type-btn").forEach((btn) => {
      btn.addEventListener("click", () => close(btn.dataset.type));
    });
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(null));
    overlay.querySelector(".confirm-modal-backdrop").addEventListener("click", () => close(null));
  });
}
