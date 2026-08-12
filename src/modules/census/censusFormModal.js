import { store } from "../../core/store.js";
import { upsertPoint, findNearbyPoints } from "../../db/database.js";
import { upsertMarker } from "./markers.js";

/**
 * Module de Formulaire de Recensement Tactile avec Validation Temps Réel
 */

export function initCensusFormModal() {
  const modalHtml = `
    <div id="censusFormModal" class="census-modal" style="display:none;">
      <div class="census-modal-backdrop" id="censusModalBackdrop"></div>
      <div class="census-modal-card">
        <div class="census-modal-header">
          <div class="census-modal-title">
            <span class="census-header-icon">📋</span>
            <div>
              <h3 id="censusFormTitle">Fiche de Recensement</h3>
              <p id="censusFormSubtitle">Bingerville — Recensement Terrain</p>
            </div>
          </div>
          <button id="censusFormCloseBtn" class="census-close-btn">✕</button>
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
              <input type="text" id="cf_name" placeholder="Ex: Kouadio Koffi Jean" required autocomplete="off" />
              <span id="cf_name_val" class="input-val-badge"></span>
            </div>
            <div id="cf_name_err" class="input-hint">Nom du responsable du logement ou local.</div>
          </div>

          <!-- Téléphone CI -->
          <div class="form-group">
            <label for="cf_tel">Numéro Téléphone (Côte d'Ivoire) <span class="req">*</span></label>
            <div class="input-with-icon">
              <input type="tel" id="cf_tel" placeholder="Ex: 07 08 09 10 11" maxlength="14" autocomplete="off" />
              <span id="cf_tel_val" class="input-val-badge"></span>
            </div>
            <div id="cf_tel_err" class="input-hint">Format CI 10 chiffres (début 01, 05, 07...).</div>
          </div>

          <!-- Statut Tactile -->
          <div class="form-group">
            <label>Statut du Recensement <span class="req">*</span></label>
            <div class="tactile-status-group" id="cf_status_group">
              <button type="button" class="status-pill active" data-status="VERT (Joignable)" style="--pill-color:#2ecc71">
                <span class="pill-dot"></span> Vert (Joignable)
              </button>
              <button type="button" class="status-pill" data-status="JAUNE (Injoignable)" style="--pill-color:#f1c40f">
                <span class="pill-dot"></span> Jaune (Injoignable)
              </button>
              <button type="button" class="status-pill" data-status="ROUGE (Refus)" style="--pill-color:#e74c3c">
                <span class="pill-dot"></span> Rouge (Refus)
              </button>
              <button type="button" class="status-pill" data-status="VIOLET (A verifier)" style="--pill-color:#9b59b6">
                <span class="pill-dot"></span> Violet (À vérifier)
              </button>
            </div>
            <input type="hidden" id="cf_status" value="VERT (Joignable)" />
          </div>

          <!-- Genre / Sexe Tactile Segmented -->
          <div class="form-group">
            <label>Genre / Type de Local</label>
            <div class="segmented-control" id="cf_sexe_group">
              <button type="button" class="segment-btn active" data-sexe="Homme">👨 Homme</button>
              <button type="button" class="segment-btn" data-sexe="Femme">👩 Femme</button>
              <button type="button" class="segment-btn" data-sexe="Entreprise">🏢 Local Pro</button>
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

          <!-- Quartier avec Chips Tactiles -->
          <div class="form-group">
            <label for="cf_quartier">Quartier (Bingerville)</label>
            <input type="text" id="cf_quartier" placeholder="Ex: Gbagba" autocomplete="off" />
            <div class="chips-row">
              <button type="button" class="chip-q" data-q="Gbagba">Gbagba</button>
              <button type="button" class="chip-q" data-q="Bingerville Centre">Centre</button>
              <button type="button" class="chip-q" data-q="Marché">Marché</button>
              <button type="button" class="chip-q" data-q="Feh Kessé">Feh Kessé</button>
              <button type="button" class="chip-q" data-q="Santai">Santai</button>
              <button type="button" class="chip-q" data-q="Akandjé">Akandjé</button>
            </div>
          </div>

          <!-- Adresse / Lot -->
          <div class="form-group">
            <label for="cf_address">Adresse & Précisions Lot / Rue</label>
            <input type="text" id="cf_address" placeholder="Ex: Lot 412, îlot 14, Rue des Écoles" autocomplete="off" />
          </div>

          <!-- Produits & Services Multi-select Chips -->
          <div class="form-group">
            <label>Produits / Compteurs Sélectionnés</label>
            <div class="multi-chips-group" id="cf_produits_group">
              <button type="button" class="chip-p" data-p="Électricité CIE">⚡ Électricité CIE</button>
              <button type="button" class="chip-p" data-p="Eau SODECI">💧 Eau SODECI</button>
              <button type="button" class="chip-p" data-p="Fibre Orange">🍊 Fibre Orange</button>
              <button type="button" class="chip-p" data-p="Fibre MTN">🟡 Fibre MTN</button>
              <button type="button" class="chip-p" data-p="Gaz">🔥 Gaz</button>
            </div>
            <input type="hidden" id="cf_produits" value="" />
          </div>

          <!-- GPS Coordinates -->
          <div class="form-group">
            <div class="gps-header">
              <label style="margin:0;">Position GPS (Bingerville)</label>
              <button type="button" id="cf_capture_gps" class="btn-capture-gps">📍 Ma Position GPS</button>
            </div>
            <div class="row2" style="margin-top:6px;">
              <div>
                <input type="number" step="any" id="cf_lat" placeholder="Latitude (ex: 5.355)" />
              </div>
              <div>
                <input type="number" step="any" id="cf_lon" placeholder="Longitude (ex: -3.890)" />
              </div>
            </div>
            <div id="cf_proximity_warning" class="input-hint" style="display:none; margin-top:8px; padding:8px 10px; border-radius:8px; background:#fff7ed; border:1px solid #fed7aa; color:#9a3412;"></div>
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

  if (point) {
    title.textContent = `Édition Fiche #${point.order || point.id}`;
    sub.textContent = `${point.quartier || 'Bingerville'} — Bloc ${String(point.block || 1).padStart(2, '0')}`;
    document.getElementById("cf_id").value = point.id || "";
    document.getElementById("cf_name").value = point.name || "";
    document.getElementById("cf_tel").value = formatPhoneCI(point.tel || "");
    document.getElementById("cf_status").value = point.status || "VERT (Joignable)";
    document.getElementById("cf_sexe").value = point.sexe || "Homme";
    document.getElementById("cf_visited").checked = !!point.visited;
    document.getElementById("cf_quartier").value = point.quartier || "";
    document.getElementById("cf_address").value = point.address || "";
    document.getElementById("cf_produits").value = point.produits || "";
    document.getElementById("cf_lat").value = point.lat || 5.355;
    document.getElementById("cf_lon").value = point.lon || -3.890;
  } else {
    title.textContent = "Nouveau Point de Recensement";
    sub.textContent = "Saisie rapide terrain — Bingerville";
    document.getElementById("cf_id").value = "";
    document.getElementById("cf_name").value = "";
    document.getElementById("cf_tel").value = "";
    document.getElementById("cf_status").value = "VERT (Joignable)";
    document.getElementById("cf_sexe").value = "Homme";
    document.getElementById("cf_visited").checked = false;
    document.getElementById("cf_quartier").value = "Gbagba";
    document.getElementById("cf_address").value = "";
    document.getElementById("cf_produits").value = "Électricité CIE, Eau SODECI";
    
    const userPos = store.get("geo.position");
    document.getElementById("cf_lat").value = userPos ? userPos.lat.toFixed(6) : 5.355;
    document.getElementById("cf_lon").value = userPos ? userPos.lng.toFixed(6) : -3.890;
  }

  // Synchroniser l'état des composants tactiles
  syncStatusPills();
  syncSegmentedSexe();
  syncProduitsChips();

  modal.style.display = "flex";
  validateFormRealtime();
  checkProximity();
}

// Avertit si un point existant se trouve à moins de 25m — évite d'enregistrer
// deux fois le même ménage (un agent qui n'a pas vu la fiche déjà créée par
// un collègue, ou une double saisie accidentelle).
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

  const nearby = await findNearbyPoints(lat, lon, 25, currentId);
  if (nearby.length === 0) {
    warningEl.style.display = "none";
    return;
  }

  const names = nearby.slice(0, 3).map(p => p.name || `Fiche #${p.order || p.id}`).join(", ");
  warningEl.style.display = "block";
  warningEl.textContent = `⚠️ ${nearby.length} fiche(s) déjà enregistrée(s) à moins de 25m de cette position (${names}). Vérifiez qu'il ne s'agit pas d'un doublon avant d'enregistrer.`;
}

export function closeCensusForm() {
  const modal = document.getElementById("censusFormModal");
  if (modal) modal.style.display = "none";
}

function bindFormEvents() {
  document.getElementById("censusFormCloseBtn")?.addEventListener("click", closeCensusForm);
  document.getElementById("censusModalBackdrop")?.addEventListener("click", closeCensusForm);

  // Inputs live validation
  document.getElementById("cf_name")?.addEventListener("input", validateFormRealtime);
  document.getElementById("cf_tel")?.addEventListener("input", (e) => {
    e.target.value = formatPhoneCI(e.target.value);
    validateFormRealtime();
  });
  document.getElementById("cf_quartier")?.addEventListener("input", validateFormRealtime);

  // Status pills click
  const statusPills = document.querySelectorAll("#cf_status_group .status-pill");
  statusPills.forEach(pill => {
    pill.addEventListener("click", () => {
      statusPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      document.getElementById("cf_status").value = pill.dataset.status;
      validateFormRealtime();
    });
  });

  // Segmented Sexe click
  const segmentBtns = document.querySelectorAll("#cf_sexe_group .segment-btn");
  segmentBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      segmentBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("cf_sexe").value = btn.dataset.sexe;
    });
  });

  // Quartier Chips
  document.querySelectorAll(".chip-q").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("cf_quartier").value = chip.dataset.q;
      validateFormRealtime();
    });
  });

  // Multi Products Chips
  document.querySelectorAll(".chip-p").forEach(chip => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      updateProduitsFromChips();
    });
  });

  // Capture GPS
  document.getElementById("cf_capture_gps")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Géolocalisation non disponible");
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
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });

  document.getElementById("cf_lat")?.addEventListener("change", checkProximity);
  document.getElementById("cf_lon")?.addEventListener("change", checkProximity);

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
      alert("Veuillez remplir correctement les champs obligatoires (Nom et Téléphone).");
      return;
    }

    const id = document.getElementById("cf_id").value;
    const pointData = {
      id: id || undefined,
      name: document.getElementById("cf_name").value.trim(),
      tel: document.getElementById("cf_tel").value.trim(),
      status: document.getElementById("cf_status").value,
      sexe: document.getElementById("cf_sexe").value,
      visited: document.getElementById("cf_visited").checked,
      quartier: document.getElementById("cf_quartier").value.trim(),
      address: document.getElementById("cf_address").value.trim(),
      produits: document.getElementById("cf_produits").value.trim(),
      lat: parseFloat(document.getElementById("cf_lat").value) || 5.355,
      lon: parseFloat(document.getElementById("cf_lon").value) || -3.890
    };

    const updated = await upsertPoint(pointData);

    // Mettre à jour le store local
    const points = store.get("points") || [];
    const idx = points.findIndex(p => p.id === updated.id);
    if (idx >= 0) {
      points[idx] = updated;
    } else {
      points.push(updated);
    }
    store.set("points", points);

    // Affiche tout de suite le badge "en attente d'envoi" sans attendre le prochain
    // passage du moteur de sync (qui tourne toutes les 30s).
    const pendingIds = new Set(store.get("sync.pendingPointIds") || []);
    pendingIds.add(updated.id);
    store.set("sync.pendingPointIds", [...pendingIds]);

    upsertMarker(updated);

    closeCensusForm();
  });
}

function syncStatusPills() {
  const current = document.getElementById("cf_status").value;
  document.querySelectorAll("#cf_status_group .status-pill").forEach(p => {
    p.classList.toggle("active", p.dataset.status === current);
  });
}

function syncSegmentedSexe() {
  const current = document.getElementById("cf_sexe").value;
  document.querySelectorAll("#cf_sexe_group .segment-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.sexe === current);
  });
}

function syncProduitsChips() {
  const val = document.getElementById("cf_produits").value || "";
  document.querySelectorAll("#cf_produits_group .chip-p").forEach(c => {
    c.classList.toggle("active", val.includes(c.dataset.p));
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

  const nameBadge = document.getElementById("cf_name_val");
  const nameErr = document.getElementById("cf_name_err");
  const telBadge = document.getElementById("cf_tel_val");
  const telErr = document.getElementById("cf_tel_err");

  const isNameValid = nameVal.length >= 2;
  const isTelValid = telVal.length === 10;

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

  if (isNameValid && isTelValid) {
    if (valBar) valBar.className = "census-val-bar val-success";
    if (valIcon) valIcon.textContent = "✅";
    if (valText) valText.textContent = "Fiche à 100% valide — Prête à être enregistrée !";
    return true;
  } else {
    if (valBar) valBar.className = "census-val-bar val-warning";
    if (valIcon) valIcon.textContent = "⚠️";
    if (valText) valText.textContent = "Saisie incomplète : vérifiez le Nom et le Numéro (10 chiffres).";
    return false;
  }
}
