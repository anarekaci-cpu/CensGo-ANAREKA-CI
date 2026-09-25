// Jeu d'icônes SVG de l'interface (remplace les emoji dans l'habillage de
// la carte). Trait 2px, couleur héritée (currentColor) : suit le thème
// clair/sombre et l'état actif sans CSS supplémentaire. Chaînes statiques,
// sûres à injecter via innerHTML (aucune donnée utilisateur).

const svg = (body, size = 20) =>
  `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  locate: svg('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>'),
  hazard: svg('<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 17.2h.01"/>'),
  satellite: svg('<path d="m12 3 9 4.8-9 4.8-9-4.8z"/><path d="m3 12.2 9 4.8 9-4.8"/><path d="m3 16.6 9 4.8 9-4.8"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 26),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: svg('<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7z"/>'),
  nearest: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="m9.6 10 2.4-2.4 2.4 2.4M12 7.6V13"/>', 18)
};

/**
 * Logo CensGo : pin de carte doré rempli de « grains » (clin d'œil à
 * l'attiéké) sur vert forêt ANAREKA. Même dessin que public/icon-*.svg.
 * @param {number} size
 */
export function logoSvg(size = 28) {
  return `<svg class="censgo-logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M32 6c-10.5 0-19 8.3-19 18.6C13 38.4 32 58 32 58s19-19.6 19-33.4C51 14.3 42.5 6 32 6z" fill="#E0A526"/>
    <circle cx="32" cy="24.5" r="9.5" fill="#143825"/>
    <g fill="#F6E7B8"><circle cx="28.6" cy="21.6" r="1.6"/><circle cx="34.4" cy="20.6" r="1.4"/><circle cx="36.3" cy="25.8" r="1.6"/><circle cx="31.4" cy="27.4" r="1.5"/><circle cx="27.4" cy="26.4" r="1.2"/><circle cx="32.2" cy="23.6" r="1.1"/></g>
  </svg>`;
}
