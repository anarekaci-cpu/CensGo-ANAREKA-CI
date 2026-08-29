const DISMISS_KEY = "censgo.install-prompt-dismissed-at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours avant de reproposer
const SHOW_DELAY_MS = 4000; // laisse l'app finir son montage avant d'afficher le bandeau

let deferredPrompt = null;

function isStandalone() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true // iOS Safari : déjà installée
  );
}

function wasDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Stockage indisponible (navigation privée) — le bandeau réapparaîtra à
    // la prochaine visite, ce qui reste acceptable (pas de perte de données).
  }
}

function hideBanner() {
  document.getElementById("install-banner")?.remove();
}

function showBanner() {
  if (document.getElementById("install-banner")) return;

  const banner = document.createElement("div");
  banner.id = "install-banner";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Installer l'application");
  banner.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;background:#1a3d2b;color:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px;animation:toastIn 0.3s ease;";

  const text = document.createElement("span");
  text.style.cssText = "flex:1;font-size:14px;font-weight:500;";
  text.textContent = "📲 Installez CensGo pour y accéder hors connexion, en un tap depuis l'écran d'accueil.";
  banner.appendChild(text);

  const installBtn = document.createElement("button");
  installBtn.textContent = "Installer";
  installBtn.style.cssText = "background:#fff;color:#1a3d2b;border:none;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;white-space:nowrap;cursor:pointer;";
  installBtn.addEventListener("click", async () => {
    hideBanner();
    if (!deferredPrompt) return;
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    await promptEvent.userChoice;
  });
  banner.appendChild(installBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "✕";
  dismissBtn.setAttribute("aria-label", "Ne plus proposer");
  dismissBtn.style.cssText = "background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;padding:4px;line-height:1;";
  dismissBtn.addEventListener("click", () => {
    rememberDismissal();
    hideBanner();
  });
  banner.appendChild(dismissBtn);

  document.body.appendChild(banner);
}

/**
 * Capture l'événement natif Chromium (jamais déclenché sur iOS/Safari, qui
 * n'a pas d'API d'installation programmatique — le bandeau n'y apparaît
 * simplement jamais) au lieu de laisser le navigateur proposer son propre
 * prompt silencieux, que la plupart des agents ne remarquent jamais.
 * À appeler tôt (avant tout montage) pour ne pas rater l'événement.
 */
export function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideBanner();
  });
}

/**
 * À appeler après une action significative (ex: montage de l'app une fois
 * connecté) plutôt qu'au chargement de la page — un visiteur qui n'a pas
 * encore vu l'app n'a aucune raison de l'installer, et le montrer trop tôt
 * n'apprend rien sur la valeur de l'installation.
 */
export function maybeShowInstallPrompt() {
  if (isStandalone() || wasDismissedRecently()) return;
  setTimeout(() => {
    if (deferredPrompt) showBanner();
  }, SHOW_DELAY_MS);
}
