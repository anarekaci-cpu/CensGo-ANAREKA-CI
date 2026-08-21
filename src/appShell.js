import { store } from "./core/store.js";
import { login } from "./modules/auth/auth.js";

function describeLoginError(e) {
  const msg = e?.message || "";

  if (msg.includes("Supabase non configuré")) {
    return "Configuration manquante : VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ne sont pas définies.";
  }
  if (e instanceof TypeError || /fetch|network|NetworkError/i.test(msg)) {
    return "Impossible de contacter le serveur Supabase. Vérifiez l'URL configurée (VITE_SUPABASE_URL) et votre connexion internet.";
  }
  if (/invalid login credentials/i.test(msg)) {
    return "Email ou mot de passe incorrect.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Ce compte n'a pas encore été confirmé. Vérifiez l'e-mail de confirmation ou confirmez-le manuellement dans Supabase.";
  }
  return msg ? `Erreur de connexion : ${msg}` : "Échec de la connexion. Réessayez.";
}

export class App {
  constructor(container) {
    this.container = container;
    this.unsubs = [];
    this._appModule = null;
    this._appMounted = false;
  }

  async mount() {
    this.unsubs.push(store.subscribe("user", () => {
      this.render();
    }));
    this.render();
  }

  render() {
    const user = store.get("user");
    if (!user) {
      this._appMounted = false;
      this.renderLogin();
      return;
    }
    // Garde-fou : si l'application authentifiée est déjà à l'écran, ne JAMAIS
    // la démonter pour la remonter (le boot screen réapparaîtrait, la carte
    // serait réinitialisée, les données retéléchargées et les listeners
    // document-level se cumuleraient). Seule une déconnexion repasse par
    // renderLogin() qui remet _appMounted à false.
    if (this._appMounted) return;
    this._appMounted = true;
    this.renderApp();
  }

  renderLogin() {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox">
          <div class="login-badge">🗺️</div>
          <h1>Recensement ANAREKA-CI</h1>
          <p>Connexion agent de terrain</p>
          <input type="email" id="loginEmail" placeholder="Email" autocomplete="username">
          <input type="password" id="loginPassword" placeholder="Mot de passe" autocomplete="current-password">
          <button id="loginBtn">
            <span class="login-spinner"></span>
            <span class="login-btn-text">Se connecter</span>
          </button>
          <div id="loginError" role="alert"></div>
          <div class="login-links">
            <a id="forgotPasswordLink">Mot de passe oublié ?</a>
          </div>
        </div>
      </div>
    `;

    const btn = document.getElementById("loginBtn");
    const email = document.getElementById("loginEmail");
    const password = document.getElementById("loginPassword");
    const error = document.getElementById("loginError");

    const attempt = async () => {
      if (!email.value.trim() || !password.value) {
        error.textContent = "Veuillez remplir tous les champs.";
        return;
      }
      error.textContent = "";
      btn.disabled = true;
      try {
        await login(email.value.trim(), password.value);
      } catch (e) {
        error.textContent = describeLoginError(e);
        btn.disabled = false;
      }
    };

    btn.onclick = attempt;
    email.onkeydown = (e) => { if (e.key === "Enter") password.focus(); };
    password.onkeydown = (e) => { if (e.key === "Enter") attempt(); };

    document.getElementById("forgotPasswordLink")?.addEventListener("click", () => {
      error.textContent = "Contactez votre administrateur ANAREKA-CI pour réinitialiser votre mot de passe.";
    });
  }

  async renderApp() {
    this.container.innerHTML = `
      <div id="boot-screen">
        <div class="boot-spinner"></div>
        <div class="boot-text">Chargement de l'application...</div>
        <div class="boot-status">Préparation des données et de la carte</div>
      </div>
    `;
    if (!this._appModule) {
      this._appModule = await import("./appView.js");
    }
    await this._appModule.mountAuthenticatedApp(this.container);
  }
}
