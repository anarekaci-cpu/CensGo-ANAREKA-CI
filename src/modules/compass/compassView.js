import { store } from "../../core/store.js";
import { cardinalLabel } from "../../core/geo.js";
import { computeBlipPosition, blipToPercentPosition } from "../../core/radar.js";
import { enableCompass, disableCompass, isCompassActive, getRadarTargets } from "./compass.js";
import { escapeHtml } from "../../core/utils.js";
import { openPopup } from "../census/markers.js";
import { toastWarning } from "../../core/toast.js";
import { formatDist } from "../census/distFormat.js";

let panelEl = null;
let ringEl = null;
let blipsLayerEl = null;
let hintEl = null;
let cardinalEls = [];
let unsubs = [];
let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

const CARDINAL_MARKS = [
  { label: "N", bearing: 0 },
  { label: "E", bearing: 90 },
  { label: "S", bearing: 180 },
  { label: "O", bearing: 270 }
];

function render() {
  if (!ringEl) return;

  const heading = store.get("geo.heading") || 0;
  const userPos = store.get("geo.position");
  const compassActive = isCompassActive();
  const compassError = store.get("geo.compassError");

  if (!userPos) {
    hintEl.textContent = "📍 Position GPS indisponible — activez la localisation.";
  } else if (compassError) {
    hintEl.textContent = `⚠️ ${compassError}`;
  } else if (!compassActive) {
    hintEl.textContent = "Touchez le cadran pour activer la boussole.";
  } else {
    hintEl.textContent = "Pointez le téléphone pour vous orienter vers le Nord.";
  }

  // Un seul système de positionnement, entièrement en JS : chaque repère
  // (N/E/S/O ET points radar) est placé selon SON cap réel moins le cap du
  // téléphone. Pas de rotation CSS de conteneur en plus — sinon le calcul
  // JS (qui compense déjà le cap) et la rotation CSS s'additionneraient et
  // désynchroniseraient l'affichage.
  cardinalEls.forEach(({ el, bearing }) => {
    const { leftPct, topPct } = blipToPercentPosition(computeBlipPosition(bearing, heading, 2, 2));
    el.style.left = `${leftPct}%`;
    el.style.top = `${topPct}%`;
  });

  blipsLayerEl.innerHTML = "";
  if (!userPos) return;

  const targets = getRadarTargets(5);
  const maxKm = targets.length ? Math.max(...targets.map(t => t.distanceKm), 0.1) : 1;

  targets.forEach(({ point, distanceKm, bearing }) => {
    const pos = computeBlipPosition(bearing, heading, distanceKm, maxKm);
    const { leftPct, topPct } = blipToPercentPosition(pos);
    const blip = document.createElement("button");
    blip.type = "button";
    blip.className = "radar-blip";
    blip.style.left = `${leftPct}%`;
    blip.style.top = `${topPct}%`;
    blip.title = `${point.name || "Fiche"} — ${formatDist(distanceKm)}`;
    blip.innerHTML = `<span class="radar-blip-dot"></span><span class="radar-blip-label">${escapeHtml(formatDist(distanceKm))}</span>`;
    blip.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopup(point.id);
      closeCompassPanel();
    });
    blipsLayerEl.appendChild(blip);
  });
}

function updateHeadingReadout() {
  const label = document.getElementById("compassHeadingLabel");
  if (!label) return;
  const heading = store.get("geo.heading") || 0;
  label.textContent = `${Math.round(heading)}° ${cardinalLabel(heading)}`;
}

export function openCompassPanel() {
  if (!panelEl) return;
  panelEl.classList.add("open");
  scheduleRender();
  updateHeadingReadout();
}

export function closeCompassPanel() {
  panelEl?.classList.remove("open");
}

async function handleDialTap() {
  if (isCompassActive()) return;
  const ok = await enableCompass();
  if (!ok) {
    const err = store.get("geo.compassError");
    if (err) toastWarning(err);
  }
  scheduleRender();
}

/** Monte le panneau boussole (idempotent) et câble les abonnements store. */
export function mountCompass() {
  if (panelEl) return; // déjà monté

  const main = document.getElementById("main");
  if (!main) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div id="compassPanel" class="compass-panel">
      <div class="compass-panel-head">
        <span>🧭 Boussole terrain</span>
        <button type="button" id="compassCloseBtn" aria-label="Fermer la boussole">✕</button>
      </div>
      <div class="compass-dial" id="compassDial">
        <div class="compass-ring" id="compassRing">
          <div class="cardinal-marks-layer" id="cardinalMarksLayer"></div>
          <div class="radar-blips-layer" id="radarBlipsLayer"></div>
        </div>
        <div class="compass-pointer">▲</div>
        <div class="compass-center-dot"></div>
      </div>
      <div class="compass-readout" id="compassHeadingLabel">—</div>
      <div class="compass-hint" id="compassHint">Touchez le cadran pour activer la boussole.</div>
    </div>
  `;
  main.appendChild(wrapper.firstElementChild);

  panelEl = document.getElementById("compassPanel");
  ringEl = document.getElementById("compassRing");
  blipsLayerEl = document.getElementById("radarBlipsLayer");
  hintEl = document.getElementById("compassHint");

  const marksLayer = document.getElementById("cardinalMarksLayer");
  cardinalEls = CARDINAL_MARKS.map(({ label, bearing }) => {
    const el = document.createElement("span");
    el.className = `compass-label${label === "N" ? " compass-label-n" : ""}`;
    el.textContent = label;
    marksLayer.appendChild(el);
    return { el, bearing };
  });

  document.getElementById("compassCloseBtn").addEventListener("click", closeCompassPanel);
  document.getElementById("compassDial").addEventListener("click", handleDialTap);

  unsubs.push(store.subscribe("geo.heading", () => { scheduleRender(); updateHeadingReadout(); }));
  unsubs.push(store.subscribe("geo.position", scheduleRender));
  unsubs.push(store.subscribe("geo.compassActive", scheduleRender));
  unsubs.push(store.subscribe("geo.compassError", scheduleRender));
  unsubs.push(store.subscribe("points", scheduleRender));
}

export function unmountCompass() {
  unsubs.forEach(u => u());
  unsubs = [];
  disableCompass();
  panelEl?.remove();
  panelEl = null;
  ringEl = null;
  blipsLayerEl = null;
  hintEl = null;
  cardinalEls = [];
}
