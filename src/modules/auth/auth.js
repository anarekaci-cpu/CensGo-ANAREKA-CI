import { getSession, signIn, signUp, signOut, onAuthStateChange } from "../../core/supabase.js";
import { store } from "../../core/store.js";
import { initGeolocation } from "../geolocation/geolocation.js";
import { redeemInvite } from "../../core/invites.js";

const PENDING_INVITE_KEY = "censgo.pendingInvite";

// Capture ?invite=TOKEN dès le chargement de la page (avant même que
// l'agent choisisse connexion/inscription) et nettoie l'URL — un lien copié/
// partagé depuis la barre d'adresse APRÈS ce nettoyage ne contiendrait plus
// le token, donc ce nettoyage doit avoir lieu après l'avoir mémorisé, jamais
// avant. sessionStorage (pas juste une variable JS) : survit à un rechargement
// de page dans le même onglet, ce qui couvre le flux "confirmation email"
// (Supabase peut rediriger vers une URL sans le paramètre invite).
export function capturePendingInviteFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) {
      sessionStorage.setItem(PENDING_INVITE_KEY, token);
      params.delete("invite");
      const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", cleanUrl);
    }
  } catch {
    // sessionStorage indisponible (navigation privée stricte, etc.) : le
    // lien d'invitation ne sera simplement pas appliqué automatiquement,
    // l'agent retombe sur le flux normal "en attente de validation admin".
  }
}

/** Pour l'écran de connexion/inscription : afficher un indice visuel avant
 * même la tentative de connexion (voir appShell.js). */
export function hasPendingInvite() {
  try {
    return Boolean(sessionStorage.getItem(PENDING_INVITE_KEY));
  } catch {
    return false;
  }
}

export async function consumePendingInviteIfAny() {
  let token = null;
  try {
    token = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (token) sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    return;
  }
  if (!token) return;
  const granted = await redeemInvite(token);
  store.set("ui.inviteJustRedeemed", granted);
}

export async function initAuth() {
  capturePendingInviteFromUrl();
  try {
    const session = await getSession();
    store.set("user", session?.user || null);
    if (session?.user) await consumePendingInviteIfAny();
  } catch (e) {
    console.warn("[AUTH] Session check failed:", e);
    store.set("user", null);
  }
  onAuthStateChange((session) => {
    const next = session?.user || null;
    const prev = store.get("user");
    // Supabase émet INITIAL_SESSION, SIGNED_IN puis TOKEN_REFRESHED avec à
    // chaque fois un NOUVEL objet user (même identité). Comparer par id et
    // non par référence : sinon chaque événement déclenchait un re-render
    // COMPLET de l'application (remontée du boot screen, réinitialisation de
    // la carte, re-téléchargement des 500+ points, listeners dupliqués).
    if ((next?.id || null) !== (prev?.id || null)) {
      store.set("user", next);
      // Nouvelle connexion (pas juste un refresh de token) : c'est le seul
      // moment où consommer une invitation a du sens (compte tout juste
      // authentifié, éventuellement encore role=NULL côté serveur).
      if (next) consumePendingInviteIfAny();
    }
  });
}

export async function login(email, password) {
  store.set("ui.loading", true);
  try {
    const session = await signIn(email, password);
    store.set("user", session.user);
    initGeolocation();
    // Couvre le cas d'un agent qui a d'abord créé son compte (donc encore
    // "en attente"), reçoit ensuite un lien d'invitation, et se reconnecte
    // au lieu de se réinscrire — sans effet si son rôle est déjà défini
    // (garde "role IS NULL" côté serveur, voir supabase/add_invites.sql).
    await consumePendingInviteIfAny();
    return session;
  } finally {
    store.set("ui.loading", false);
  }
}

/**
 * @returns {Promise<{needsEmailConfirmation: boolean}>}
 */
export async function register(email, password, fullName) {
  store.set("ui.loading", true);
  try {
    const { session, user } = await signUp(email, password, fullName);
    if (session) {
      // Confirmation par e-mail désactivée sur ce projet : session immédiate.
      store.set("user", session.user);
      initGeolocation();
      // Appelé ICI (pas seulement dans onAuthStateChange) : ce store.set()
      // met déjà "prev" à jour avant que l'événement SIGNED_IN émis par
      // supabase-js n'atteigne le listener de initAuth() — sans cet appel
      // direct, la garde par comparaison d'id de onAuthStateChange ne
      // déclencherait jamais la consommation de l'invitation pour ce flux.
      await consumePendingInviteIfAny();
      return { needsEmailConfirmation: false };
    }
    // Confirmation par e-mail requise par le projet Supabase : signUp()
    // crée bien le compte (et déclenche le trigger côté serveur) mais ne
    // renvoie aucune session tant que le lien reçu par e-mail n'est pas
    // cliqué — rien à faire ici d'autre que prévenir l'agent.
    return { needsEmailConfirmation: Boolean(user && !session) };
  } finally {
    store.set("ui.loading", false);
  }
}

export async function logout() {
  await signOut();
  store.set("user", null);
}
