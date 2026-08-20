import { escapeHtml } from "./utils.js";

export function confirmAction(title, desc, { danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", title);
    overlay.innerHTML = `
      <div class="confirm-modal-backdrop"></div>
      <div class="confirm-modal-card">
        <div class="confirm-modal-title">${escapeHtml(title)}</div>
        <div class="confirm-modal-desc">${escapeHtml(desc)}</div>
        <div class="confirm-modal-actions">
          <button class="confirm-cancel">Annuler</button>
          <button class="${danger ? 'confirm-danger' : 'confirm-primary'}">Confirmer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cancel = overlay.querySelector(".confirm-cancel");
    const confirm = overlay.querySelector(`.${danger ? 'confirm-danger' : 'confirm-primary'}`);
    const close = (result) => { overlay.remove(); resolve(result); };
    cancel.onclick = () => close(false);
    confirm.onclick = () => close(true);
    overlay.querySelector(".confirm-modal-backdrop").onclick = () => close(false);
  });
}
