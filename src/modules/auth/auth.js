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
    store.set("user", session?.user || null);
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

export function getCurrentUser() {
  return store.get("user");
}

export function isAuthenticated() {
  return !!store.get("user");
}
