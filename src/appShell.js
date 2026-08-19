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
      this.renderLogin();
    } else {
      this.renderApp();
    }
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
          <button id="loginBtn">Se connecter</button>
          <div id="loginError"></div>
        </div>
      </div>
    `;

    const btn = document.getElementById("loginBtn");
    const email = document.getElementById("loginEmail");
    const password = document.getElementById("loginPassword");
    const error = document.getElementById("loginError");

    const attempt = async () => {
      error.textContent = "";
      btn.disabled = true;
      btn.textContent = "Connexion...";
      try {
        await login(email.value.trim(), password.value);
      } catch (e) {
        error.textContent = describeLoginError(e);
        btn.disabled = false;
        btn.textContent = "Se connecter";
      }
    };

    btn.onclick = attempt;
    password.onkeydown = (e) => { if (e.key === "Enter") attempt(); };
  }

  async renderApp() {
    if (!this._appModule) {
      this._appModule = await import("./appView.js");
    }
    await this._appModule.mountAuthenticatedApp(this.container);
  }
}
