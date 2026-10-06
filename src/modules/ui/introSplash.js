/**
 * Splash d'ouverture premium : logo animé (anneau tracé + épingles qui
 * apparaissent), mot-symbole lettre par lettre, barre de progression, puis
 * sortie en « iris » vers l'app. Affiché une fois par session ; avec
 * prefers-reduced-motion : simple fondu court, sans mouvement.
 */

const SESSION_KEY = "censgo.intro.seen";
const MIN_VISIBLE_MS = 1900;
const REDUCED_VISIBLE_MS = 500;

const PINS = [
  { x: 34, y: 38, d: 0.9 },
  { x: 66, y: 30, d: 1.05 },
  { x: 58, y: 62, d: 1.2 },
  { x: 28, y: 66, d: 1.35 }
];

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function alreadySeen() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* stockage indisponible : l'intro pourra se rejouer, sans gravité */
  }
}

function letters(text, startDelay) {
  return [...text]
    .map((ch, i) => `<span class="intro-letter" style="--i:${(startDelay + i * 0.045).toFixed(3)}s">${ch}</span>`)
    .join("");
}

function buildMarkup() {
  const pins = PINS.map(
    (p) =>
      `<g transform="translate(${p.x} ${p.y})">
         <g class="intro-pin" style="--d:${p.d}s">
           <circle class="intro-pin-pulse" r="3.2"/>
           <circle class="intro-pin-dot" r="2.1"/>
         </g>
       </g>`
  ).join("");

  return `
    <div class="intro-aurora" aria-hidden="true"></div>
    <div class="intro-grid" aria-hidden="true"></div>
    <div class="intro-center">
      <svg class="intro-logo" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="introRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4ade80"/>
            <stop offset="1" stop-color="#ff7a00"/>
          </linearGradient>
        </defs>
        <circle class="intro-ring-track" cx="50" cy="50" r="44"/>
        <circle class="intro-ring" cx="50" cy="50" r="44" pathLength="100"/>
        ${pins}
      </svg>
      <h1 class="intro-title" aria-label="CensGo">${letters("CensGo", 0.55)}</h1>
      <p class="intro-tag">${letters("ANAREKA-CI", 1.0)}</p>
      <div class="intro-progress" aria-hidden="true"><span></span></div>
    </div>`;
}

/**
 * Monte le splash au-dessus de l'app. Renvoie une promesse résolue quand
 * le splash est entièrement retiré. Sans effet si déjà vu dans la session.
 */
export function showIntroSplash() {
  if (typeof document === "undefined") return Promise.resolve();
  if (alreadySeen()) {
    document.body.classList.add("app-revealed");
    return Promise.resolve();
  }
  markSeen();

  const reduced = prefersReducedMotion();
  const el = document.createElement("div");
  el.id = "intro-splash";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", "Chargement de CensGo");
  if (reduced) el.classList.add("is-reduced");
  el.innerHTML = buildMarkup();
  document.body.appendChild(el);

  const visibleFor = reduced ? REDUCED_VISIBLE_MS : MIN_VISIBLE_MS;

  return new Promise((resolve) => {
    setTimeout(() => {
      el.classList.add("is-leaving");
      const done = () => {
        el.remove();
        document.body.classList.add("app-revealed");
        resolve();
      };
      el.addEventListener("animationend", (e) => {
        if (e.target === el) done();
      });
      // Filet : si animationend ne part pas (onglet masqué, animations coupées).
      setTimeout(done, 1100);
    }, visibleFor);
  });
}
