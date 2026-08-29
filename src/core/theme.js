/**
 * Mode sombre — bascule manuelle par-dessus la préférence système déjà
 * gérée par CSS (@media (prefers-color-scheme: dark), voir style.css).
 *
 * Sans ce module, un agent dont le téléphone est réglé en clair n'a AUCUN
 * moyen d'activer le sombre lui-même (et inversement) : le thème suivait
 * uniquement l'OS. Le choix explicite est persisté (localStorage) et prend
 * le pas sur la préférence système dans les deux sens via l'attribut
 * data-theme sur <html> — voir les sélecteurs :root[data-theme="dark"] /
 * :root[data-theme="light"] dans style.css.
 */

const STORAGE_KEY = "censgo-theme";

function readStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Stockage indisponible (navigation privée stricte, etc.) : pas de
    // préférence explicite, on retombe sur la préférence système.
    return null;
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark" || theme === "light") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

/**
 * Sombre par défaut (demande explicite) tant qu'un agent n'a pas choisi
 * lui-même le clair via le bouton lune/soleil — readStoredTheme() reste
 * toujours prioritaire, donc un choix déjà fait (dans un sens ou l'autre)
 * n'est jamais écrasé. Avant ce changement, une préférence système claire
 * (matchMedia) l'emportait par défaut ; ce n'est plus le cas.
 */
const DEFAULT_THEME = "dark";

/** À appeler le plus tôt possible (avant le premier rendu) pour éviter un flash du mauvais thème. */
export function initTheme() {
  applyTheme(readStoredTheme() || DEFAULT_THEME);
}

/** @returns {"dark"|"light"} le thème effectivement affiché (choix explicite, sinon sombre par défaut). */
export function getEffectiveTheme() {
  return readStoredTheme() || DEFAULT_THEME;
}

/** Bascule et persiste le thème. @returns {"dark"|"light"} le nouveau thème appliqué. */
export function toggleTheme() {
  const next = getEffectiveTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Pas de persistance possible : le choix reste actif pour cette session
    // (applyTheme() ci-dessous s'applique quand même), juste pas retenu au
    // prochain chargement.
  }
  applyTheme(next);
  return next;
}
