let container = null;
const MAX_VISIBLE = 3;
let visibleCount = 0;

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

function vibrate(pattern) {
  try { navigator.vibrate(pattern); } catch (_) { /* haptic not supported */ }
}

export function showToast(message, { type = "info", duration = 4000 } = {}) {
  const c = ensureContainer();

  if (visibleCount >= MAX_VISIBLE) {
    const oldest = c.firstChild;
    if (oldest) oldest.remove();
    visibleCount--;
  }

  const colors = {
    info: { bg: "#1a3d2b", color: "#fff" },
    success: { bg: "#16a34a", color: "#fff" },
    warning: { bg: "#d97706", color: "#fff" },
    error: { bg: "#dc2626", color: "#fff" }
  };

  const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" };
  const style = colors[type] || colors.info;

  const toast = document.createElement("div");
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  toast.style.cssText = `background:${style.bg};color:${style.color};padding:12px 16px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.25);pointer-events:auto;display:flex;align-items:center;gap:8px;animation:toastIn 0.3s ease;max-width:100%;word-break:break-word;`;

  const textSpan = document.createElement("span");
  textSpan.style.flex = "1";
  textSpan.textContent = `${icons[type] || ""} ${message}`;
  toast.appendChild(textSpan);

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "toast-dismiss";
  dismissBtn.textContent = "✕";
  dismissBtn.setAttribute("aria-label", "Fermer");
  dismissBtn.style.color = style.color;
  dismissBtn.addEventListener("click", () => dismissToast(toast));
  toast.appendChild(dismissBtn);

  toast.addEventListener("click", () => dismissToast(toast));

  c.appendChild(toast);
  visibleCount++;

  if (type === "error") vibrate(200);
  else if (type === "warning") vibrate(100);

  if (duration > 0) {
    toast._timer = setTimeout(() => dismissToast(toast), duration);
  }
}

function dismissToast(toast) {
  if (toast._dismissed) return;
  toast._dismissed = true;
  if (toast._timer) clearTimeout(toast._timer);
  toast.style.animation = "toastOut 0.3s ease forwards";
  toast.addEventListener("animationend", () => {
    toast.remove();
    visibleCount--;
  });
}

export function toastInfo(msg) { showToast(msg, { type: "info" }); }
export function toastSuccess(msg) { showToast(msg, { type: "success" }); }
export function toastWarning(msg) { showToast(msg, { type: "warning" }); }
export function toastError(msg) { showToast(msg, { type: "error", duration: 10000 }); }
