import { store } from "./core/store.js";
import { login, register } from "./modules/auth/auth.js";
import { escapeHtml } from "./core/utils.js";

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

function describeSignupError(e) {
  const msg = e?.message || "";
  if (msg.includes("Supabase non configuré")) {
    return "Configuration manquante : VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ne sont pas définies.";
  }
  if (e instanceof TypeError || /fetch|network|NetworkError/i.test(msg)) {
    return "Impossible de contacter le serveur Supabase. Vérifiez votre connexion internet.";
  }
  if (/already registered|user already exists/i.test(msg)) {
    return "Un compte existe déjà avec cet e-mail — connectez-vous plutôt.";
  }
  if (/password.*(least|short|weak)/i.test(msg)) {
    return "Mot de passe trop court (6 caractères minimum).";
  }
  return msg ? `Erreur d'inscription : ${msg}` : "Échec de l'inscription. Réessayez.";
}

export class App {
  constructor(container) {
    this.container = container;
    this.unsubs = [];
    this._appModulePromise = null;
    this._appMounted = false;
  }

  // Démarre le téléchargement du gros module post-connexion (carte MapLibre,
  // vue principale — le plus gros morceau JS de l'app) PENDANT que l'agent
  // saisit encore ses identifiants, au lieu d'attendre la confirmation
  // Supabase pour commencer à le récupérer. import() n'exécute que le code
  // de haut niveau des modules (abonnements au store, déclarations) — aucun
  // effet de bord DOM tant que mountAuthenticatedApp() n'est pas appelée
  // explicitement, donc sans risque de perturber l'écran de connexion. Le
  // résultat (réussi ou non) est simplement mis en cache : renderApp()
  // attend cette même promesse au lieu d'en relancer une nouvelle.
  _prefetchAppModule() {
    if (!this._appModulePromise) {
      this._appModulePromise = import("./appView.js").catch((err) => {
        // Un échec ici (coupure réseau pendant la saisie) ne doit pas
        // empêcher un nouvel essai au moment réel de la connexion.
        this._appModulePromise = null;
        throw err;
      });
    }
    return this._appModulePromise;
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
      // Un changement de "user" (déconnexion) ne doit PAS renvoyer un agent
      // déjà en plein milieu d'une saisie d'inscription vers l'accueil — ce
      // cas ne se produit qu'au tout premier rendu (aucun écran affiché) ou
      // après une vraie déconnexion, jamais pendant que renderSignup()/
      // renderLogin() sont déjà à l'écran (ils ne touchent pas "user" avant
      // succès). L'accueil est donc le bon point d'entrée par défaut.
      this.renderWelcome();
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

  renderWelcome() {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox" class="welcome-box">
          <div class="login-badge">🗺️</div>
          <h1>CensGo</h1>
          <p class="welcome-tagline">Recensement terrain des restaurateurs, kiosques d'attiéké et vendeurs ambulants — ANAREKA-CI, Côte d'Ivoire.</p>
          <div class="welcome-actions">
            <button id="goLoginBtn" class="welcome-btn-primary">Se connecter</button>
            <button id="goSignupBtn" class="welcome-btn-secondary">Créer un compte agent</button>
          </div>
        </div>
      </div>
    `;

    // Démarre le téléchargement du gros module post-connexion dès
    // l'accueil (avant même que l'agent choisisse connexion/inscription) —
    // c'est l'écran affiché le plus tôt et le plus longtemps.
    this._prefetchAppModule().catch(() => { /* retenté au moment réel de la connexion */ });

    document.getElementById("goLoginBtn").onclick = () => this.renderLogin();
    document.getElementById("goSignupBtn").onclick = () => this.renderSignup();
  }

  renderLogin() {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox">
          <div class="login-badge">🗺️</div>
          <h1>CensGo</h1>
          <p>Connexion agent de terrain — ANAREKA-CI</p>
          <input type="email" id="loginEmail" placeholder="Email" autocomplete="username">
          <input type="password" id="loginPassword" placeholder="Mot de passe" autocomplete="current-password">
          <button id="loginBtn">
            <span class="login-spinner"></span>
            <span class="login-btn-text">Se connecter</span>
          </button>
          <div id="loginError" role="alert"></div>
          <div class="login-links">
            <a id="goSignupLink">Créer un compte agent</a>
            <span aria-hidden="true"> · </span>
            <a id="forgotPasswordLink">Mot de passe oublié ?</a>
          </div>
        </div>
      </div>
    `;

    this._prefetchAppModule().catch(() => { /* renderApp() retentera au moment réel de la connexion */ });

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

    document.getElementById("goSignupLink")?.addEventListener("click", () => this.renderSignup());
    document.getElementById("forgotPasswordLink")?.addEventListener("click", () => {
      error.textContent = "Contactez votre administrateur ANAREKA-CI pour réinitialiser votre mot de passe.";
    });
  }

  renderSignup() {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox" class="signup-box">
          <div class="login-badge">🗺️</div>
          <h1>Créer un compte</h1>
          <p>Inscription agent de terrain — ANAREKA-CI</p>
          <div class="signup-name-row">
            <input type="text" id="signupFirstName" placeholder="Prénom" autocomplete="given-name">
            <input type="text" id="signupLastName" placeholder="Nom" autocomplete="family-name">
          </div>
          <input type="email" id="signupEmail" placeholder="Email" autocomplete="username">
          <input type="password" id="signupPassword" placeholder="Mot de passe (6 caractères min.)" autocomplete="new-password">
          <button id="signupBtn">
            <span class="login-spinner"></span>
            <span class="login-btn-text">Créer mon compte</span>
          </button>
          <div id="signupError" role="alert"></div>
          <div class="login-links">
            <a id="goLoginLink">J'ai déjà un compte — Se connecter</a>
          </div>
        </div>
      </div>
    `;

    const btn = document.getElementById("signupBtn");
    const firstName = document.getElementById("signupFirstName");
    const lastName = document.getElementById("signupLastName");
    const email = document.getElementById("signupEmail");
    const password = document.getElementById("signupPassword");
    const error = document.getElementById("signupError");

    const attempt = async () => {
      const fullName = `${firstName.value.trim()} ${lastName.value.trim()}`.trim();
      if (!firstName.value.trim() || !lastName.value.trim() || !email.value.trim() || !password.value) {
        error.textContent = "Veuillez remplir tous les champs.";
        return;
      }
      if (password.value.length < 6) {
        error.textContent = "Mot de passe trop court (6 caractères minimum).";
        return;
      }
      error.textContent = "";
      btn.disabled = true;
      try {
        const { needsEmailConfirmation } = await register(email.value.trim(), password.value, fullName);
        if (needsEmailConfirmation) {
          this.renderSignupPending(email.value.trim());
        }
        // Sinon : session immédiate -> store.set("user", ...) déjà fait par
        // register(), le render() déclenché par l'abonnement "user" prend
        // le relais automatiquement (écran principal, carte vide en
        // attendant la validation admin — voir appView.js/ui.pendingApproval).
      } catch (e) {
        error.textContent = describeSignupError(e);
        btn.disabled = false;
      }
    };

    btn.onclick = attempt;
    [firstName, lastName, email].forEach((input, idx, arr) => {
      input.onkeydown = (e) => { if (e.key === "Enter") (arr[idx + 1] || password).focus(); };
    });
    password.onkeydown = (e) => { if (e.key === "Enter") attempt(); };

    document.getElementById("goLoginLink")?.addEventListener("click", () => this.renderLogin());
  }

  renderSignupPending(email) {
    this.container.innerHTML = `
      <div id="loginScreen">
        <div class="login-backdrop"></div>
        <div id="loginBox">
          <div class="login-badge">📬</div>
          <h1>Vérifiez vos e-mails</h1>
          <p>Un lien de confirmation a été envoyé à <b>${escapeHtml(email)}</b>. Cliquez dessus, puis connectez-vous — un administrateur devra ensuite valider votre compte avant que vous puissiez voir les données.</p>
          <div class="welcome-actions">
            <button id="backToLoginBtn" class="welcome-btn-primary">Se connecter</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById("backToLoginBtn").onclick = () => this.renderLogin();
  }

  async renderApp() {
    this.container.innerHTML = `
      <div id="boot-screen">
        <div class="boot-spinner"></div>
        <div class="boot-text">Chargement de l'application...</div>
        <div class="boot-status">Préparation des données et de la carte</div>
      </div>
    `;
    const appModule = await this._prefetchAppModule();
    await appModule.mountAuthenticatedApp(this.container);
  }
}
