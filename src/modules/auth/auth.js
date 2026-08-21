import { getSession, signIn, signOut, onAuthStateChange } from "../../core/supabase.js";
import { store } from "../../core/store.js";

export async function initAuth() {
  try {
    const session = await getSession();
    store.set("user", session?.user || null);
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
    }
  });
}

export async function login(email, password) {
  store.set("ui.loading", true);
  try {
    const session = await signIn(email, password);
    store.set("user", session.user);
    return session;
  } finally {
    store.set("ui.loading", false);
  }
}

export async function logout() {
  await signOut();
  store.set("user", null);
}
