/**
 * Système de notifications toast non-bloquant
 * Remplace les alert() qui gèlent l'interface et le GPS
 */

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("role", "status");
    container.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:90vw;";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, { type = "info", duration = 4000 } = {}) {
  const c = ensureContainer();

  const colors = {
    info: { bg: "#1a3d2b", color: "#fff" },
    success: { bg: "#16a34a", color: "#fff" },
    warning: { bg: "#d97706", color: "#fff" },
    error: { bg: "#dc2626", color: "#fff" }
  };

  const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" };
  const style = colors[type] || colors.info;

  const toast = document.createElement("div");
  toast.style.cssText = `background:${style.bg};color:${style.color};padding:12px 20px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.25);pointer-events:auto;display:flex;align-items:center;gap:8px;animation:toastIn 0.3s ease;max-width:100%;word-break:break-word;`;
  toast.textContent = `${icons[type] || ""} ${message}`;

  c.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

export function toastInfo(msg) { showToast(msg, { type: "info" }); }
export function toastSuccess(msg) { showToast(msg, { type: "success" }); }
export function toastWarning(msg) { showToast(msg, { type: "warning" }); }
export function toastError(msg) { showToast(msg, { type: "error", duration: 6000 }); }
