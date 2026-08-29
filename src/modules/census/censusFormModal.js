import { store } from "../../core/store.js";
import { CONFIG } from "../../core/config.js";
import { upsertPoint, savePendingPhoto } from "../../db/database.js";
import { toastWarning, toastSuccess } from "../../core/toast.js";
import { getMap } from "../map/map.js";
import { confirmAction } from "../../core/confirmModal.js";
import { isValidLatLng } from "../../core/normalize.js";
import { canMarkVisited } from "../../core/geofence.js";
import { normalizePointId, escapeHtml } from "../../core/utils.js";
import { findProximityMatches } from "./proximityMatch.js";
import { compressPhoto } from "../../core/photoCompression.js";
import { extractExifGps } from "../../core/exif.js";
import { haversineKm } from "../../core/geo.js";

// Au-delà de cette distance entre la position GPS EXIF de la photo et la
// position actuelle de l'agent, la photo est probablement une ancienne
// photo de galerie plutôt qu'une prise fraîche sur le terrain — même seuil
// et même logique que checkPhotoGeotag() dans appView.js (onglet Vision IA),
// dupliqué ici en plus petit pour éviter un import croisé vers appView.js
// (module de plus haut niveau, qui importe déjà ce fichier-ci).
const PHOTO_GEOTAG_WARNING_M = 500;

// Doublon "flou" : nom très proche (typo/variante d'orthographe) OU
// téléphone identique, dans un rayon plus large que le doublon "strict"
// (25m — même emplacement GPS). Un même établissement peut être re-recensé
// à quelques dizaines de mètres d'écart si le GPS a dérivé, ou son nom
// ressaisi avec une variante ("Kouassi"/"Kwassi").
const FUZZY_DUPLICATE_RADIUS_M = 150;
const FUZZY_NAME_THRESHOLD = 0.78;
const CENSUS_DRAFT_KEY = "censgo.census-form-draft";
const CENSUS_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CENSUS_DRAFT_FIELDS = ["name", "tel", "etablissement", "activity", "sexe", "visited", "city", "quartier", "address", "produits", "lat", "lon"];

/**
 * Module de Formulaire de Recensement Tactile avec Validation Temps Réel
 */

// Photo obligatoire à la CRÉATION d'un point (pas à l'édition, voir plan) :
// reste en mémoire (Blob déjà compressé) jusqu'au submit, jamais dans le
// brouillon localStorage (CENSUS_DRAFT_FIELDS) — un Blob ne s'y prête pas et
// une image y dépasserait vite le quota de localStorage. Écrite dans Dexie
// (savePendingPhoto()) seulement une fois le point réellement créé, pour
// avoir l'id définitif du point comme clé étrangère.
let pendingPhoto = null; // { blob, mimeType } | null

function resetPendingPhoto() {
  pendingPhoto = null;
  const preview = document.getElementById("cf_photoPreview");
  if (preview) { preview.style.display = "none"; preview.innerHTML = ""; }
  const btn = document.getElementById("cf_photoBtn");
  if (btn) { btn.textContent = "📷 Prendre une photo (obligatoire)"; btn.classList.remove("photo-captured"); }
}

/**
 * Avertissement non-bloquant (pas un blocage strict comme dans l'onglet
 * Vision IA d'appView.js) : signale une photo probablement ancienne/hors
 * zone, mais un GPS EXIF absent (cas fréquent, métadonnées retirées par
 * l'app photo du téléphone) ne doit jamais empêcher de continuer.
 */
async function warnIfPhotoLooksStale(file) {
  try {
    const buffer = await file.arrayBuffer();
    const exifGps = extractExifGps(buffer);
    const livePos = store.get("geo.position");
    if (!exifGps || !livePos) return;
    const distanceKm = haversineKm(livePos.lat, livePos.lng, exifGps.lat, exifGps.lon);
    if (distanceKm * 1000 > PHOTO_GEOTAG_WARNING_M) {
      toastWarning("Cette photo semble avoir été prise loin de votre position actuelle — vérifiez qu'il s'agit bien d'une prise fraîche sur place.");
    }
  } catch {
    // Best-effort — une photo sans EXIF ou un échec de lecture ne doit
    // jamais bloquer la capture, seulement priver l'agent de cet avertissement.
  }
}

export function initCensusFormModal() {
  const modalHtml = `
    <div id="censusFormModal" class="census-modal" role="dialog" aria-modal="true" aria-label="Fiche de recensement" style="display:none;">
      <div class="census-modal-backdrop" id="censusModalBackdrop"></div>
      <div class="census-modal-card">
        <div class="census-modal-header">
          <div class="census-modal-title">
            <span class="census-header-icon">📋</span>
            <div>
              <h3 id="censusFormTitle">Fiche de Recensement</h3>
              <p id="censusFormSubtitle">CensGo — Recensement Terrain ANAREKA-CI</p>
            </div>
          </div>
          <button id="censusFormCloseBtn" class="census-close-btn" aria-label="Fermer le formulaire">✕</button>
        </div>

        <div id="censusValidationBar" class="census-val-bar val-info">
          <span id="censusValStatusIcon">⚡</span>
          <span id="censusValStatusText">Saisie des données en cours...</span>
        </div>

        <form id="censusForm" class="census-form-body" novalidate>
          <input type="hidden" id="cf_id" value="" />

          <!-- Nom Contact / Chef Ménage -->
          <div class="form-group">
            <label for="cf_name">Nom & Prénoms / Raison Sociale <span class="req">*</span></label>
            <div class="input-with-icon">
              <input type="text" id="cf_name" placeholder="Ex: Kouadio Koffi Jean" required autocomplete="off" enterkeyhint="next" />
              <span id="cf_name_val" class="input-val-badge"></span>
            </div>
            <div id="cf_name_err" class="input-hint">Nom du restaurateur / responsable de l'établissement.</div>
          </div>

          <!-- Téléphone CI -->
          <div class="form-group">
            <label for="cf_tel">Numéro Téléphone (Côte d'Ivoire) <span class="req">*</span></label>
            <div class="input-with-icon">
              <input type="tel" id="cf_tel" placeholder="Ex: 07 08 09 10 11" maxlength="14" autocomplete="off" enterkeyhint="next" inputmode="numeric" />
              <span id="cf_tel_val" class="input-val-badge"></span>
            </div>
            <div id="cf_tel_err" class="input-hint">Format CI 10 chiffres (début 01, 05, 07...).</div>
          </div>

          <!-- Nom de l'établissement -->
          <div class="form-group">
            <label for="cf_etablissement">Nom de l'établissement / Kiosque</label>
            <input type="text" id="cf_etablissement" placeholder="Ex: Chez Tantie Aya" autocomplete="off" />
          </div>

          <!-- Type d'activité -->
          <div class="form-group">
            <label>Type d'activité <span class="req">*</span></label>
            <div class="chips-row" id="cf_activity_group" role="group" aria-label="Type d'activité">
              <button type="button" class="chip-a" data-activity="Kiosque d'attiéké fixe" aria-pressed="false">🏪 Kiosque fixe</button>
              <button type="button" class="chip-a" data-activity="Restaurant traditionnel" aria-pressed="false">🍽️ Restaurant</button>
              <button type="button" class="chip-a" data-activity="Vendeur ambulant" aria-pressed="false">🚶 Vendeur ambulant</button>
              <button type="button" class="chip-a" data-activity="Producteur d'attiéké" aria-pressed="false">🌾 Producteur</button>
              <button type="button" class="chip-a" data-activity="Maquis / Gargote" aria-pressed="false">🍲 Maquis / Gargote</button>
              <button type="button" class="chip-a" data-activity="Autre" aria-pressed="false">➕ Autre</button>
            </div>
            <input type="hidden" id="cf_activity" value="" />
          </div>

          <!-- Genre du responsable -->
          <div class="form-group">
            <label>Genre du responsable</label>
            <div class="segmented-control" id="cf_sexe_group" role="group" aria-label="Genre du responsable">
              <button type="button" class="segment-btn active" data-sexe="Homme" aria-pressed="true">👨 Homme</button>
              <button type="button" class="segment-btn" data-sexe="Femme" aria-pressed="false">👩 Femme</button>
            </div>
            <input type="hidden" id="cf_sexe" value="Homme" />
          </div>

          <!-- Visité Switch Tactile -->
          <div class="form-group form-group-row">
            <div>
              <label style="margin:0;">Statut Visité</label>
              <div class="input-hint" style="margin:0;">Cocher si la fiche est complétée</div>
            </div>
            <label class="tactile-switch">
              <input type="checkbox" id="cf_visited" />
              <span class="slider round"></span>
            </label>
          </div>

          <!-- Ville : liste fermée gérée par l'admin (voir core/cities.js) -->
          <div class="form-group">
            <label for="cf_city">Ville <span class="req">*</span></label>
            <select id="cf_city" required></select>
            <div id="cf_city_err" class="input-hint">Liste gérée par l'administrateur — contactez-le si votre ville manque.</div>
          </div>

          <!-- Quartier avec Chips Tactiles (générées depuis les quartiers déjà recensés) -->
          <div class="form-group">
            <label for="cf_quartier">Quartier</label>
            <input type="text" id="cf_quartier" placeholder="Ex: Cocody, Yopougon..." autocomplete="off" />
            <div class="chips-row" id="cf_quartier_chips"></div>
          </div>

          <!-- Emplacement -->
          <div class="form-group">
            <label for="cf_address">Emplacement précis (repère, rue...)</label>
            <input type="text" id="cf_address" placeholder="Ex: En face du marché, près de la pharmacie" autocomplete="off" />
          </div>

          <!-- Produits & Spécialités Multi-select Chips -->
          <div class="form-group">
            <label>Produits / Spécialités proposées</label>
            <div class="multi-chips-group" id="cf_produits_group" role="group" aria-label="Produits / Spécialités proposées">
              <button type="button" class="chip-p" data-p="Attiéké Poisson" aria-pressed="false">🐟 Attiéké Poisson</button>
              <button type="button" class="chip-p" data-p="Attiéké Poulet" aria-pressed="false">🍗 Attiéké Poulet</button>
              <button type="button" class="chip-p" data-p="Attiéké Viande/Grillades" aria-pressed="false">🍖 Viande/Grillades</button>
              <button type="button" class="chip-p" data-p="Attiéké Nature" aria-pressed="false">🍚 Attiéké Nature</button>
              <button type="button" class="chip-p" data-p="Garba" aria-pressed="false">🥘 Garba</button>
              <button type="button" class="chip-p" data-p="Boissons/Jus" aria-pressed="false">🥤 Boissons/Jus</button>
            </div>
            <input type="hidden" id="cf_produits" value="" />
          </div>

          <!-- GPS Coordinates -->
          <div class="form-group">
            <div class="gps-header">
              <label style="margin:0;">Position GPS</label>
              <button type="button" id="cf_capture_gps" class="btn-capture-gps">📍 Ma Position GPS</button>
            </div>
            <div class="row2" style="margin-top:6px;">
              <div>
                <input type="number" step="any" id="cf_lat" placeholder="Latitude" />
              </div>
              <div>
                <input type="number" step="any" id="cf_lon" placeholder="Longitude" />
              </div>
            </div>
            <div id="cf_proximity_warning" class="input-hint" style="display:none; margin-top:8px; padding:8px 10px; border-radius:8px; background:#fff7ed; border:1px solid #fed7aa; color:#9a3412;"></div>
          </div>

          <!-- Photo obligatoire (création uniquement) : preuve que l'endroit
               existe réellement, en complément du GPS — voir supabase/add_census_photos.sql -->
          <div class="form-group" id="cf_photo_group" style="display:none;">
            <label>Photo de l'établissement <span class="req">*</span></label>
            <input type="file" id="cf_photo" accept="image/*" capture="environment" style="display:none;" />
            <button type="button" id="cf_photoBtn" class="btn-capture-gps">📷 Prendre une photo (obligatoire)</button>
            <div id="cf_photoPreview" class="cf-photo-preview" style="display:none;"></div>
            <div id="cf_photo_err" class="input-hint">Une photo fraîche du kiosque/restaurant est requise pour valider la fiche.</div>
          </div>

          <!-- Actions Footer -->
          <div class="form-actions">
            <button type="button" id="cf_ai_fix" class="btn-ai-format">✨ Nettoyer avec l'IA</button>
            <button type="submit" id="cf_save_btn" class="btn-save-census">💾 Enregistrer la Fiche</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
  bindFormEvents();
}

export function openCensusForm(point = null) {
  const modal = document.getElementById("censusFormModal");
  if (!modal) return;

  const title = document.getElementById("censusFormTitle");
  const sub = document.getElementById("censusFormSubtitle");

  // Position de secours si aucune position réelle n'est disponible : le centre
  // actuel de la carte (là où l'agent/admin regarde déjà) plutôt qu'un point fixe
  // — sinon une nouvelle fiche créée loin d'Abidjan atterrirait à tort au siège.
  const map = getMap();
  const fallbackCenter = map ? map.getCenter() : { lat: CONFIG.MAP_CENTER[0], lng: CONFIG.MAP_CENTER[1] };

  populateCityOptions();
  resetPendingPhoto();
  // Obligatoire seulement à la CRÉATION — une fiche déjà existante n'a pas à
  // reprendre une photo pour être modifiée (voir plan : "se rassurer des
  // endroits" vise l'existence du point, pas chaque édition ultérieure).
  const photoGroup = document.getElementById("cf_photo_group");
  if (photoGroup) photoGroup.style.display = point ? "none" : "block";

  if (point) {
    title.textContent = `Édition Fiche #${point.order || point.id}`;
    sub.textContent = `${point.quartier || 'Zone non renseignée'} — ${point.etablissement || point.activityType || 'ANAREKA-CI'}`;
    document.getElementById("cf_id").value = point.id || "";
    document.getElementById("cf_name").value = point.name || "";
    document.getElementById("cf_tel").value = formatPhoneCI(point.tel || "");
    document.getElementById("cf_etablissement").value = point.etablissement || "";
    document.getElementById("cf_activity").value = point.activityType || "";
    document.getElementById("cf_sexe").value = point.sexe || "Homme";
    document.getElementById("cf_visited").checked = !!point.visited;
    document.getElementById("cf_city").value = point.city || "";
    document.getElementById("cf_quartier").value = point.quartier || "";
    document.getElementById("cf_address").value = point.address || "";
    document.getElementById("cf_produits").value = point.produits || "";
    document.getElementById("cf_lat").value = point.lat ?? fallbackCenter.lat.toFixed(6);
    document.getElementById("cf_lon").value = point.lon ?? fallbackCenter.lng.toFixed(6);
  } else {
    title.textContent = "Nouveau Point de Recensement";
    sub.textContent = "CensGo — Saisie rapide terrain";
    document.getElementById("cf_id").value = "";
    document.getElementById("cf_name").value = "";
    document.getElementById("cf_tel").value = "";
    document.getElementById("cf_etablissement").value = "";
    document.getElementById("cf_activity").value = "";
    document.getElementById("cf_sexe").value = "Homme";
    document.getElementById("cf_visited").checked = false;
    document.getElementById("cf_quartier").value = "";
    document.getElementById("cf_address").value = "";
    document.getElementById("cf_produits").value = "";

    const userPos = store.get("geo.position");
    document.getElementById("cf_lat").value = userPos ? userPos.lat.toFixed(6) : fallbackCenter.lat.toFixed(6);
    document.getElementById("cf_lon").value = userPos ? userPos.lng.toFixed(6) : fallbackCenter.lng.toFixed(6);

    const restored = restoreDraft();
    if (restored) {
      document.getElementById("censusValStatusText").textContent = "Brouillon local restauré — vérifiez les données avant d'enregistrer.";
    }
  }

  // Synchroniser l'état des composants tactiles
  renderQuartierChips();
  syncSegmentedSexe();
  syncActivityChips();
  syncProduitsChips();

  modal.style.display = "flex";
  validateFormRealtime();
  checkProximity();
}

// Peuple le select "Ville" depuis la liste fermée gérée par l'admin (voir
// core/cities.js) — jamais de texte libre côté agent, pour éviter les
// variantes d'orthographe qui fragmenteraient les statistiques par ville.
// Conserve la sélection précédente si toujours valide (agent qui enchaîne
// plusieurs fiches dans la même ville) ; sinon pré-sélectionne automatiquement
// s'il n'existe qu'une seule ville configurée (cas mono-ville actuel).
function populateCityOptions() {
  const select = document.getElementById("cf_city");
  if (!select) return;
  const cities = store.get("cities") || [];
  const previousValue = select.value;
  const placeholder = cities.length
    ? `<option value="">Choisir une ville…</option>`
    : `<option value="">Aucune ville configurée — contactez l'admin</option>`;
  select.innerHTML = placeholder + cities.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");

  if (previousValue && cities.some(c => c.name === previousValue)) {
    select.value = previousValue;
  } else if (cities.length === 1) {
    select.value = cities[0].name;
  }
}

// Génère les chips de quartier à partir des quartiers déjà recensés (les plus
// fréquents en premier) au lieu d'une liste figée sur une seule ville — pour que
// le formulaire s'adapte à n'importe quelle zone où les agents travaillent.
function renderQuartierChips() {
  const container = document.getElementById("cf_quartier_chips");
  if (!container) return;

  const points = store.get("points") || [];
  const counts = new Map();
  points.forEach(p => {
    const q = (p.quartier || "").trim();
    if (q) counts.set(q, (counts.get(q) || 0) + 1);
  });

  // Les zones cibles (ajoutées par un admin, sans aucun point encore) passent
  // en premier — c'est justement là qu'on veut qu'un agent crée la toute
  // première fiche, avec le nom exact plutôt qu'une variante mal orthographiée.
  const targetZoneNames = (store.get("targetZones") || []).map(z => z.name);
  const existingTop = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([q]) => q)
    .filter(q => !targetZoneNames.includes(q));

  const top = [...targetZoneNames, ...existingTop].slice(0, 10);

  container.innerHTML = top.map(q => {
    const isTarget = targetZoneNames.includes(q);
    return `<button type="button" class="chip-q" data-q="${escapeHtml(q)}">${isTarget ? "🎯 " : ""}${escapeHtml(q)}</button>`;
  }).join("");

  container.querySelectorAll(".chip-q").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("cf_quartier").value = chip.dataset.q;
      validateFormRealtime();
      checkProximity();
    });
  });
}

// Avertit si un point existant se trouve à moins de 25m — évite d'enregistrer
// deux fois le même ménage (un agent qui n'a pas vu la fiche déjà créée par
// un collègue, ou une double saisie accidentelle).
let proximityDebounceTimer = null;
function debouncedCheckProximity() {
  if (proximityDebounceTimer) clearTimeout(proximityDebounceTimer);
  proximityDebounceTimer = setTimeout(checkProximity, 400);
}

async function checkProximity() {
  const warningEl = document.getElementById("cf_proximity_warning");
  if (!warningEl) return;

  const lat = parseFloat(document.getElementById("cf_lat")?.value);
  const lon = parseFloat(document.getElementById("cf_lon")?.value);
  const currentId = document.getElementById("cf_id")?.value || null;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    warningEl.style.display = "none";
    return;
  }

  // Un seul passage sur les points déjà en mémoire (store, source de vérité
  // partagée avec la carte/stats) au lieu de deux requêtes IndexedDB
  // séquentielles (findNearbyPoints strict puis flou) — même détection de
  // doublons, sans aller-retour DB à chaque frappe.
  const name = document.getElementById("cf_name")?.value.trim() || "";
  const tel = document.getElementById("cf_tel")?.value || "";
  const { strict: nearby, fuzzy: fuzzyMatches } = findProximityMatches(store.get("points") || [], {
    lat,
    lon,
    name,
    tel,
    excludeId: currentId,
    strictRadiusM: 25,
    fuzzyRadiusM: FUZZY_DUPLICATE_RADIUS_M,
    fuzzyNameThreshold: FUZZY_NAME_THRESHOLD
  });

  if (nearby.length === 0 && fuzzyMatches.length === 0) {
    warningEl.style.display = "none";
    return;
  }

  const messages = [];
  if (nearby.length > 0) {
    const names = nearby.slice(0, 3).map(p => p.name || `Fiche #${p.order || p.id}`).join(", ");
    messages.push(`⚠️ ${nearby.length} fiche(s) déjà enregistrée(s) à moins de 25m de cette position (${names}).`);
  }
  if (fuzzyMatches.length > 0) {
    const names = fuzzyMatches.slice(0, 3).map(p => p.name || `Fiche #${p.order || p.id}`).join(", ");
    messages.push(`🔍 ${fuzzyMatches.length} fiche(s) au nom/téléphone très proche à moins de ${FUZZY_DUPLICATE_RADIUS_M}m (${names}).`);
  }
  messages.push("Vérifiez qu'il ne s'agit pas d'un doublon avant d'enregistrer.");

  warningEl.style.display = "block";
  warningEl.textContent = messages.join(" ");
}

export async function closeCensusForm() {
  const nameEl = document.getElementById("cf_name");
  const telEl = document.getElementById("cf_tel");
  // Un OU, pas un ET : le téléphone est légitimement vide pour un ménage
  // injoignable (voir SECURITY.md/modèle métier) — exiger les DEUX champs
  // remplis avant d'avertir laissait fermer sans confirmation une fiche où
  // l'agent avait saisi nom + adresse + GPS mais pas de téléphone, perdant
  // toute la saisie sans le moindre avertissement.
  if ((nameEl && nameEl.value.trim()) || (telEl && telEl.value.trim())) {
    const ok = await confirmAction(
      "Fermer sans enregistrer ?",
      "Des données ont été saisies mais non enregistrées. Voulez-vous vraiment fermer ?"
    );
    if (!ok) return;
  }
  const modal = document.getElementById("censusFormModal");
  if (modal) modal.style.display = "none";
}

function bindFormEvents() {
  document.getElementById("censusFormCloseBtn")?.addEventListener("click", () => closeCensusForm());
  document.getElementById("censusModalBackdrop")?.addEventListener("click", () => closeCensusForm());

  // Clavier virtuel : quand un champ prend le focus, on le centre dans la
  // partie visible. Sans ça, sur les Android d'entrée de gamme qui
  // redimensionnent (ou pire, panent) la fenêtre à l'ouverture du clavier,
  // le champ actif restait masqué derrière le clavier et l'agent tapait
  // "dans le vide".
  const form = document.getElementById("censusForm");
  form?.addEventListener("input", saveDraft);
  form?.addEventListener("change", saveDraft);
  form?.addEventListener("click", () => queueMicrotask(saveDraft));

  form?.addEventListener("focusin", (e) => {
    if (!e.target.matches("input, textarea, select")) return;
    setTimeout(() => {
      e.target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 300);
  });

  // Touche Entrée / bouton "Suivant" du clavier virtuel : passe au champ
  // suivant au lieu de soumettre la fiche à moitié remplie (comportement
  // par défaut d'un <form> avec bouton submit).
  document.getElementById("censusForm")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches('input[type="text"], input[type="tel"]')) return;
    e.preventDefault();
    const focusables = [...e.currentTarget.querySelectorAll('input[type="text"], input[type="tel"], button.chip-a')];
    const idx = focusables.indexOf(e.target);
    focusables[idx + 1]?.focus();
  });

  // Inputs live validation
  document.getElementById("cf_name")?.addEventListener("input", () => {
    validateFormRealtime();
    debouncedCheckProximity();
  });
  document.getElementById("cf_tel")?.addEventListener("input", (e) => {
    e.target.value = formatPhoneCI(e.target.value);
    validateFormRealtime();
    debouncedCheckProximity();
  });
  document.getElementById("cf_city")?.addEventListener("change", validateFormRealtime);
  document.getElementById("cf_quartier")?.addEventListener("input", validateFormRealtime);

  // Segmented Sexe click
  const segmentBtns = document.querySelectorAll("#cf_sexe_group .segment-btn");
  segmentBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      segmentBtns.forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      document.getElementById("cf_sexe").value = btn.dataset.sexe;
    });
  });

  // Note : les chips de quartier sont générées dynamiquement par
  // renderQuartierChips() à chaque ouverture du formulaire (voir openCensusForm),
  // avec leurs propres écouteurs de clic — rien à câbler ici au chargement initial.

  // Type d'activité (sélection unique)
  const activityBtns = document.querySelectorAll("#cf_activity_group .chip-a");
  activityBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      activityBtns.forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      document.getElementById("cf_activity").value = btn.dataset.activity;
      validateFormRealtime();
    });
  });

  // Multi Products Chips
  document.querySelectorAll(".chip-p").forEach(chip => {
    chip.addEventListener("click", () => {
      const nowActive = chip.classList.toggle("active");
      chip.setAttribute("aria-pressed", String(nowActive));
      updateProduitsFromChips();
    });
  });

  // Capture GPS
  document.getElementById("cf_capture_gps")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toastWarning("Géolocalisation non disponible");
      return;
    }
    const btn = document.getElementById("cf_capture_gps");
    btn.textContent = "⌛ Acquisition...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById("cf_lat").value = pos.coords.latitude.toFixed(6);
        document.getElementById("cf_lon").value = pos.coords.longitude.toFixed(6);
        btn.textContent = "📍 Capturé !";
        setTimeout(() => { btn.textContent = "📍 Ma Position GPS"; }, 2000);
        checkProximity();
      },
      (_err) => {
        btn.textContent = "⚠️ Erreur GPS";
        setTimeout(() => { btn.textContent = "📍 Ma Position GPS"; }, 2000);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  document.getElementById("cf_lat")?.addEventListener("change", checkProximity);
  document.getElementById("cf_lon")?.addEventListener("change", checkProximity);

  // Photo obligatoire (création uniquement, voir cf_photo_group/openCensusForm)
  document.getElementById("cf_photoBtn")?.addEventListener("click", () => {
    document.getElementById("cf_photo")?.click();
  });
  document.getElementById("cf_photo")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de reprendre la MÊME photo deux fois de suite si besoin
    if (!file) return;

    const btn = document.getElementById("cf_photoBtn");
    if (btn) { btn.disabled = true; btn.textContent = "⌛ Traitement..."; }
    try {
      const { blob, mimeType } = await compressPhoto(file);
      pendingPhoto = { blob, mimeType };
      warnIfPhotoLooksStale(file); // fire-and-forget, non-bloquant

      const preview = document.getElementById("cf_photoPreview");
      if (preview) {
        const url = URL.createObjectURL(blob);
        preview.innerHTML = `<img src="${url}" alt="Photo de l'établissement" />`;
        preview.style.display = "block";
      }
      if (btn) { btn.textContent = "📷 Photo prise — reprendre"; btn.classList.add("photo-captured"); }
      validateFormRealtime();
    } catch {
      toastWarning("Impossible de traiter cette photo — réessayez.");
      if (btn) btn.textContent = "📷 Prendre une photo (obligatoire)";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // AI Clean Up
  document.getElementById("cf_ai_fix")?.addEventListener("click", () => {
    const nameEl = document.getElementById("cf_name");
    const telEl = document.getElementById("cf_tel");
    const addressEl = document.getElementById("cf_address");

    if (nameEl.value) {
      nameEl.value = nameEl.value.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }
    if (telEl.value) {
      telEl.value = formatPhoneCI(telEl.value);
    }
    if (addressEl.value) {
      addressEl.value = addressEl.value.trim();
    }
    validateFormRealtime();
    const valBar = document.getElementById("censusValidationBar");
    if (valBar) {
      valBar.className = "census-val-bar val-success";
      document.getElementById("censusValStatusIcon").textContent = "✨";
      document.getElementById("censusValStatusText").textContent = "Champs formatés avec succès !";
    }
  });

  // Form Submission
  document.getElementById("censusForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateFormRealtime()) {
      const isCreating = !document.getElementById("cf_id")?.value;
      toastWarning(`Veuillez remplir correctement les champs obligatoires (Nom, Téléphone, Ville et Type d'activité${isCreating ? ", et prendre une photo" : ""}).`);
      return;
    }

    // Garde de ré-entrance : sans elle, un double-tap sur "Enregistrer"
    // (fréquent au doigt, surtout en attente d'une réponse réseau lente)
    // exécutait ce handler deux fois avant que le premier upsertPoint()
    // n'ait résolu. Pour une NOUVELLE fiche (id vide), chaque appel génère
    // un crypto.randomUUID() différent -> deux fiches en double créées à
    // partir d'un seul tap perçu par l'agent.
    const saveBtn = document.getElementById("cf_save_btn");
    if (saveBtn?.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    const id = document.getElementById("cf_id").value;
    // Comparaison par id NORMALISÉ : un vieux point du cache peut porter un
    // id numérique (123) alors que le champ caché du formulaire contient
    // "123" (string) — sans normalisation, l'édition créerait un DOUBLON.
    const existingPoint = id
      ? (store.get("points") || []).find(p => normalizePointId(p.id) === normalizePointId(id))
      : null;

    // Validation des coordonnées (#9) : lat ∈ [-90,90], lon ∈ [-180,180].
    // Une donnée invalide ne doit JAMAIS casser la carte (feature GeoJSON
    // corrompue) ni atterrir silencieusement au mauvais endroit.
    const rawLat = parseFloat(document.getElementById("cf_lat").value);
    const rawLon = parseFloat(document.getElementById("cf_lon").value);
    let lat = rawLat;
    let lon = rawLon;
    if (!isValidLatLng(rawLat, rawLon)) {
      if (Number.isFinite(rawLat) || Number.isFinite(rawLon)) {
        toastWarning("Coordonnées GPS invalides — position du centre de carte utilisée par défaut.");
      }
      lat = CONFIG.MAP_CENTER[0];
      lon = CONFIG.MAP_CENTER[1];
    }

    // NB : pas de normalizePoint() ici volontairement — ses valeurs par
    // défaut (block:0, order:null) écraseraient les défauts métier posés
    // par upsertPoint() (block:1, order:maxLocalId+1). Les types produits
    // par le formulaire sont déjà conformes au format normalisé.
    const pointData = {
      id: id || undefined,
      name: document.getElementById("cf_name").value.trim(),
      tel: document.getElementById("cf_tel").value.trim(),
      etablissement: document.getElementById("cf_etablissement").value.trim(),
      activityType: document.getElementById("cf_activity").value,
      status: existingPoint ? existingPoint.status : "NON DEFINI",
      sexe: document.getElementById("cf_sexe").value,
      visited: document.getElementById("cf_visited").checked,
      city: document.getElementById("cf_city").value,
      quartier: document.getElementById("cf_quartier").value.trim(),
      address: document.getElementById("cf_address").value.trim(),
      produits: document.getElementById("cf_produits").value.trim(),
      lat,
      lon
    };

    try {
      // Même contrôle anti-fraude que le bouton "Visité" du popup (voir
      // core/geofence.js) : la fiche de recensement offre un second chemin
      // vers visited=true qui contournerait sinon totalement ce contrôle.
      // Ne s'applique qu'au PASSAGE à true (fiche déjà visitée qu'on
      // ré-enregistre sans y toucher, ou qu'on décoche : jamais bloqué).
      if (pointData.visited && !existingPoint?.visited && !canMarkVisited(lat, lon)) {
        return;
      }

      const updated = await upsertPoint(pointData);

      // Enfile la photo APRÈS upsertPoint() : on n'a l'id définitif du point
      // (généré ici pour une création, voir database.js) qu'à cet instant —
      // la photo devient une entrée Dexie séparée (db.photos), envoyée par
      // syncEngine.js indépendamment de la synchro du point lui-même (best
      // effort, ne bloque jamais l'agent si l'upload échoue/tarde).
      if (!id && pendingPhoto) {
        await savePendingPhoto({ pointId: updated.id, blob: pendingPhoto.blob, mimeType: pendingPhoto.mimeType });
      }

      // Mettre à jour le store avec un NOUVEAU tableau : muter l'ancien et le
      // repasser à store.set() ne déclenche AUCUNE notification (comparaison
      // par référence) — les marqueurs, stats et la tournée ne se mettaient
      // alors à jour que grâce au upsertMarker manuel ci-dessous.
      const points = store.get("points") || [];
      const updatedId = normalizePointId(updated.id);
      const idx = points.findIndex(p => normalizePointId(p.id) === updatedId);
      const nextPoints = idx >= 0
        ? points.map(p => (normalizePointId(p.id) === updatedId ? updated : p))
        : [...points, updated];
      store.set("points", nextPoints);

      // Affiche tout de suite le badge "en attente d'envoi" sans attendre le prochain
      // passage du moteur de sync (qui tourne toutes les 30s).
      const pendingIds = new Set((store.get("sync.pendingPointIds") || []).map(normalizePointId));
      pendingIds.add(updatedId);
      store.set("sync.pendingPointIds", [...pendingIds]);
      clearDraft();
      resetPendingPhoto();

      // Pas d'appel upsertMarker() ici : l'abonnement "points" re-rend les
      // marqueurs en respectant les filtres actifs (un point créé hors filtre
      // n'apparaît pas, ce qui est le comportement attendu).

      toastSuccess(id ? "Fiche modifiée avec succès." : "Nouvelle fiche enregistrée.");
      closeCensusForm();
    } catch (err) {
      // La garde de ré-entrance (saveBtn.disabled) resterait bloquée pour
      // toujours sans ce chemin d'erreur — l'agent doit pouvoir réessayer.
      toastWarning(err?.message || "Échec de l'enregistrement — réessayez.");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(CENSUS_DRAFT_KEY) || "null");
    if (!draft || typeof draft !== "object") return null;
    if (draft.savedAt && Date.now() - Date.parse(draft.savedAt) > CENSUS_DRAFT_MAX_AGE_MS) {
      clearDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function saveDraft() {
  const id = document.getElementById("cf_id")?.value;
  if (id) return;

  const draft = {};
  CENSUS_DRAFT_FIELDS.forEach(field => {
    const element = document.getElementById(`cf_${field}`);
    if (element) draft[field] = element.type === "checkbox" ? element.checked : element.value;
  });

  if (!draft.name && !draft.tel && !draft.etablissement && !draft.activity && !draft.quartier && !draft.address) {
    clearDraft();
    return;
  }

  try {
    localStorage.setItem(CENSUS_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Storage may be unavailable in private browsing; the form remains usable.
  }
}

function restoreDraft() {
  const draft = readDraft();
  if (!draft) return false;

  CENSUS_DRAFT_FIELDS.forEach(field => {
    const element = document.getElementById(`cf_${field}`);
    if (!element || draft[field] === undefined) return;
    if (element.type === "checkbox") element.checked = !!draft[field];
    else element.value = draft[field];
  });
  return true;
}

function clearDraft() {
  try {
    localStorage.removeItem(CENSUS_DRAFT_KEY);
  } catch {
    // Storage may be unavailable; nothing else is required to clear in-memory state.
  }
}

function syncSegmentedSexe() {
  const current = document.getElementById("cf_sexe").value;
  document.querySelectorAll("#cf_sexe_group .segment-btn").forEach(b => {
    const isActive = b.dataset.sexe === current;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });
}

function syncActivityChips() {
  const current = document.getElementById("cf_activity").value;
  document.querySelectorAll("#cf_activity_group .chip-a").forEach(c => {
    const isActive = c.dataset.activity === current;
    c.classList.toggle("active", isActive);
    c.setAttribute("aria-pressed", String(isActive));
  });
}

function syncProduitsChips() {
  const val = document.getElementById("cf_produits").value || "";
  document.querySelectorAll("#cf_produits_group .chip-p").forEach(c => {
    const isActive = val.includes(c.dataset.p);
    c.classList.toggle("active", isActive);
    c.setAttribute("aria-pressed", String(isActive));
  });
}

function updateProduitsFromChips() {
  const selected = [];
  document.querySelectorAll("#cf_produits_group .chip-p.active").forEach(c => {
    selected.push(c.dataset.p);
  });
  document.getElementById("cf_produits").value = selected.join(", ");
}

function formatPhoneCI(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  let clean = digits.slice(0, 10);
  const parts = [];
  for (let i = 0; i < clean.length; i += 2) {
    parts.push(clean.slice(i, i + 2));
  }
  return parts.join(" ");
}

function validateFormRealtime() {
  const nameVal = document.getElementById("cf_name")?.value.trim() || "";
  const telVal = (document.getElementById("cf_tel")?.value || "").replace(/\D/g, "");
  const activityVal = document.getElementById("cf_activity")?.value || "";
  const cityVal = document.getElementById("cf_city")?.value || "";

  const nameBadge = document.getElementById("cf_name_val");
  const nameErr = document.getElementById("cf_name_err");
  const telBadge = document.getElementById("cf_tel_val");
  const telErr = document.getElementById("cf_tel_err");
  const cityErr = document.getElementById("cf_city_err");

  const isNameValid = nameVal.length >= 2;
  const isTelValid = telVal.length === 10;
  const isActivityValid = activityVal.length > 0;
  const isCityValid = cityVal.length > 0;
  // Photo obligatoire seulement à la création (cf_id vide) — voir openCensusForm().
  const isCreating = !document.getElementById("cf_id")?.value;
  const isPhotoValid = !isCreating || pendingPhoto != null;

  if (cityErr) cityErr.style.color = isCityValid ? "#16a34a" : "#dc2626";
  const photoErr = document.getElementById("cf_photo_err");
  if (photoErr) photoErr.style.color = isPhotoValid ? "#16a34a" : "#dc2626";

  if (nameBadge) {
    if (isNameValid) {
      nameBadge.className = "input-val-badge valid";
      nameBadge.textContent = "✓ OK";
      if (nameErr) nameErr.style.color = "#16a34a";
    } else {
      nameBadge.className = "input-val-badge invalid";
      nameBadge.textContent = "⚠️ Requis";
      if (nameErr) nameErr.style.color = "#dc2626";
    }
  }

  if (telBadge) {
    if (isTelValid) {
      telBadge.className = "input-val-badge valid";
      telBadge.textContent = "✓ 10 Chiffres";
      if (telErr) telErr.style.color = "#16a34a";
    } else if (telVal.length > 0) {
      telBadge.className = "input-val-badge invalid";
      telBadge.textContent = `${telVal.length}/10`;
      if (telErr) telErr.style.color = "#eab308";
    } else {
      telBadge.className = "input-val-badge invalid";
      telBadge.textContent = "⚠️ Requis";
      if (telErr) telErr.style.color = "#dc2626";
    }
  }

  const valBar = document.getElementById("censusValidationBar");
  const valIcon = document.getElementById("censusValStatusIcon");
  const valText = document.getElementById("censusValStatusText");

  if (isNameValid && isTelValid && isActivityValid && isCityValid && isPhotoValid) {
    if (valBar) valBar.className = "census-val-bar val-success";
    if (valIcon) valIcon.textContent = "✅";
    if (valText) valText.textContent = "Fiche à 100% valide — Prête à être enregistrée !";
    return true;
  } else {
    if (valBar) valBar.className = "census-val-bar val-warning";
    if (valIcon) valIcon.textContent = "⚠️";
    if (valText) valText.textContent = `Saisie incomplète : vérifiez le Nom, le Numéro (10 chiffres), la Ville et le Type d'activité${isCreating ? ", et prenez une photo" : ""}.`;
    return false;
  }
}
