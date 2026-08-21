const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/tour-BxCqfCRT.js","assets/index-CtKviW6E.js","assets/supabase-DthfXWp1.js","assets/dexie-042nW8Tv.js","assets/maplibregl-CKm7LQp5.js","assets/index-oKIAmvx1.css","assets/aiAgents-CYrZUDua.js"])))=>i.map(i=>d[i]);
import{s as r,g as O,C as E,a as He,b as Ee,c as Ge,u as Ze,d as q,f as Ue,e as ge,h as Ke,i as we,j as Ae,k as Je,l as Qe,m as We,n as Ye,o as Xe,p as et,q as tt,r as nt,t as it,v as ot,w as st,x as at,_ as Ce,y as rt}from"./index-CtKviW6E.js";import{m as W}from"./maplibregl-CKm7LQp5.js";function xe(e){const t=(e==null?void 0:e.code)||"",n=(e==null?void 0:e.message)||String(e);return t==="42501"||/row-level security/i.test(n)?"Accès refusé par la base (RLS). Contactez l'administrateur : les règles d'accès bloquent la lecture des points.":t==="42P01"?`Table "${E.TABLE_NAME}" introuvable sur le serveur. Le schéma Supabase n'a pas été initialisé.`:t==="42703"?`Colonne manquante dans "${E.TABLE_NAME}" : ${n}. Le schéma du projet ne correspond pas à l'application.`:/JWT|api ?key|Invalid API key/i.test(n)?"Clé API Supabase invalide ou expirée. Vérifiez VITE_SUPABASE_ANON_KEY.":/Failed to fetch|NetworkError|network/i.test(n)?"Serveur Supabase injoignable. Vérifiez la connexion internet.":n}async function Se(e=!1){r.set("ui.loading",!0),r.set("sync.status","syncing");let t=null;if(!e)try{const o=O(),{data:s,error:a}=await o.from(E.TABLE_NAME).select("*").order("block",{ascending:!0}).order("order",{ascending:!0});if(a)throw a;if(!s||s.length===0)console.warn(`[DATA] Requête Supabase OK mais 0 ligne dans "${E.TABLE_NAME}". Causes possibles : (1) policies RLS SELECT absentes/restrictives, (2) table réellement vide, (3) mauvais projet Supabase.`),r.set("sync.warning","Le serveur a répondu mais n'a renvoyé AUCUN point. Si des points existent dans le dashboard Supabase, les règles d'accès (RLS) bloquent la lecture.");else{const c=s.map(l=>({id:l.point_id,block:l.block,order:l.order,name:l.name,tel:l.tel,etablissement:l.etablissement||"",activityType:l.activity_type||"",quartier:l.quartier,address:l.address,produits:l.produits,sexe:l.sexe,status:l.status||"NON DEFINI",visited:l.visited===!0||l.visited==="true"||l.visited==="oui",lat:l.lat,lon:l.lon}));await He(c);const m=await Ee();return await Ge("lastSync",new Date().toISOString()),r.set("points",m),r.set("sync.status","idle"),r.set("sync.lastSync",new Date().toISOString()),r.set("sync.warning",null),console.log(`📥 ${m.length} points chargés depuis Supabase`),m}}catch(o){t=o,console.error("[DATA] Échec du chargement Supabase:",o),r.set("sync.errorDetail",xe(o))}const n=await Ee();if(n.length>0)return r.set("points",n),r.set("sync.status","offline"),console.log(`📦 ${n.length} points chargés depuis IndexedDB`),n;r.set("sync.status","error");const i=t?xe(t):null;return r.set("ui.error",i?`Aucune donnée disponible. ${i}`:"Aucune donnée disponible. Vérifiez votre connexion."),[]}let C=null;const ct=3;let U=0;function lt(){return C||(C=document.createElement("div"),C.id="toast-container",C.setAttribute("aria-live","polite"),C.setAttribute("role","status"),C.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:90vw;",document.body.appendChild(C)),C}function Be(e){try{navigator.vibrate(e)}catch{}}function Y(e,{type:t="info",duration:n=4e3}={}){const i=lt();if(U>=ct){const d=i.firstChild;d&&d.remove(),U--}const o={info:{bg:"#1a3d2b",color:"#fff"},success:{bg:"#16a34a",color:"#fff"},warning:{bg:"#d97706",color:"#fff"},error:{bg:"#dc2626",color:"#fff"}},s={info:"ℹ️",success:"✅",warning:"⚠️",error:"❌"},a=o[t]||o.info,c=document.createElement("div");c.setAttribute("role",t==="error"||t==="warning"?"alert":"status"),c.style.cssText=`background:${a.bg};color:${a.color};padding:12px 16px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.25);pointer-events:auto;display:flex;align-items:center;gap:8px;animation:toastIn 0.3s ease;max-width:100%;word-break:break-word;`;const m=document.createElement("span");m.style.flex="1",m.textContent=`${s[t]||""} ${e}`,c.appendChild(m);const l=document.createElement("button");l.className="toast-dismiss",l.textContent="✕",l.setAttribute("aria-label","Fermer"),l.style.color=a.color,l.addEventListener("click",()=>te(c)),c.appendChild(l),c.addEventListener("click",()=>te(c)),i.appendChild(c),U++,t==="error"?Be(200):t==="warning"&&Be(100),n>0&&(c._timer=setTimeout(()=>te(c),n))}function te(e){e._dismissed||(e._dismissed=!0,e._timer&&clearTimeout(e._timer),e.style.animation="toastOut 0.3s ease forwards",e.addEventListener("animationend",()=>{e.remove(),U--}))}function ne(e){Y(e,{type:"info"})}function Te(e){Y(e,{type:"success"})}function P(e){Y(e,{type:"warning"})}function Le(e){Y(e,{type:"error",duration:1e4})}const Ie=document.createElement("span");function y(e){return e==null?"":(Ie.textContent=String(e),Ie.innerHTML.replace(/"/g,"&quot;"))}function de(e,t,{danger:n=!1}={}){return new Promise(i=>{const o=document.createElement("div");o.className="confirm-modal",o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true"),o.setAttribute("aria-label",e),o.innerHTML=`
      <div class="confirm-modal-backdrop"></div>
      <div class="confirm-modal-card">
        <div class="confirm-modal-title">${y(e)}</div>
        <div class="confirm-modal-desc">${y(t)}</div>
        <div class="confirm-modal-actions">
          <button class="confirm-cancel">Annuler</button>
          <button class="${n?"confirm-danger":"confirm-primary"}">Confirmer</button>
        </div>
      </div>
    `,document.body.appendChild(o);const s=o.querySelector(".confirm-cancel"),a=o.querySelector(`.${n?"confirm-danger":"confirm-primary"}`),c=m=>{o.remove(),i(m)};s.onclick=()=>c(!1),a.onclick=()=>c(!0),o.querySelector(".confirm-modal-backdrop").onclick=()=>c(!1)})}function dt(){document.body.insertAdjacentHTML("beforeend",`
    <div id="censusFormModal" class="census-modal" role="dialog" aria-modal="true" aria-label="Fiche de recensement" style="display:none;">
      <div class="census-modal-backdrop" id="censusModalBackdrop"></div>
      <div class="census-modal-card">
        <div class="census-modal-header">
          <div class="census-modal-title">
            <span class="census-header-icon">📋</span>
            <div>
              <h3 id="censusFormTitle">Fiche de Recensement</h3>
              <p id="censusFormSubtitle">ANAREKA-CI — Recensement Terrain</p>
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
            <div class="chips-row" id="cf_activity_group">
              <button type="button" class="chip-a" data-activity="Kiosque d'attiéké fixe">🏪 Kiosque fixe</button>
              <button type="button" class="chip-a" data-activity="Restaurant traditionnel">🍽️ Restaurant</button>
              <button type="button" class="chip-a" data-activity="Vendeur ambulant">🚶 Vendeur ambulant</button>
              <button type="button" class="chip-a" data-activity="Producteur d'attiéké">🌾 Producteur</button>
              <button type="button" class="chip-a" data-activity="Maquis / Gargote">🍲 Maquis / Gargote</button>
              <button type="button" class="chip-a" data-activity="Autre">➕ Autre</button>
            </div>
            <input type="hidden" id="cf_activity" value="" />
          </div>

          <!-- Genre du responsable -->
          <div class="form-group">
            <label>Genre du responsable</label>
            <div class="segmented-control" id="cf_sexe_group">
              <button type="button" class="segment-btn active" data-sexe="Homme">👨 Homme</button>
              <button type="button" class="segment-btn" data-sexe="Femme">👩 Femme</button>
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

          <!-- Quartier avec Chips Tactiles (générées depuis les quartiers déjà recensés) -->
          <div class="form-group">
            <label for="cf_quartier">Ville / Quartier</label>
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
            <div class="multi-chips-group" id="cf_produits_group">
              <button type="button" class="chip-p" data-p="Attiéké Poisson">🐟 Attiéké Poisson</button>
              <button type="button" class="chip-p" data-p="Attiéké Poulet">🍗 Attiéké Poulet</button>
              <button type="button" class="chip-p" data-p="Attiéké Viande/Grillades">🍖 Viande/Grillades</button>
              <button type="button" class="chip-p" data-p="Attiéké Nature">🍚 Attiéké Nature</button>
              <button type="button" class="chip-p" data-p="Garba">🥘 Garba</button>
              <button type="button" class="chip-p" data-p="Boissons/Jus">🥤 Boissons/Jus</button>
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

          <!-- Actions Footer -->
          <div class="form-actions">
            <button type="button" id="cf_ai_fix" class="btn-ai-format">✨ Nettoyer avec l'IA</button>
            <button type="submit" id="cf_save_btn" class="btn-save-census">💾 Enregistrer la Fiche</button>
          </div>
        </form>
      </div>
    </div>
  `),pt()}function J(e=null){const t=document.getElementById("censusFormModal");if(!t)return;const n=document.getElementById("censusFormTitle"),i=document.getElementById("censusFormSubtitle"),o=q(),s=o?o.getCenter():{lat:E.MAP_CENTER[0],lng:E.MAP_CENTER[1]};if(e)n.textContent=`Édition Fiche #${e.order||e.id}`,i.textContent=`${e.quartier||"Zone non renseignée"} — ${e.etablissement||e.activityType||"ANAREKA-CI"}`,document.getElementById("cf_id").value=e.id||"",document.getElementById("cf_name").value=e.name||"",document.getElementById("cf_tel").value=ue(e.tel||""),document.getElementById("cf_etablissement").value=e.etablissement||"",document.getElementById("cf_activity").value=e.activityType||"",document.getElementById("cf_sexe").value=e.sexe||"Homme",document.getElementById("cf_visited").checked=!!e.visited,document.getElementById("cf_quartier").value=e.quartier||"",document.getElementById("cf_address").value=e.address||"",document.getElementById("cf_produits").value=e.produits||"",document.getElementById("cf_lat").value=e.lat??s.lat.toFixed(6),document.getElementById("cf_lon").value=e.lon??s.lng.toFixed(6);else{n.textContent="Nouveau Point de Recensement",i.textContent="Saisie rapide terrain — ANAREKA-CI",document.getElementById("cf_id").value="",document.getElementById("cf_name").value="",document.getElementById("cf_tel").value="",document.getElementById("cf_etablissement").value="",document.getElementById("cf_activity").value="",document.getElementById("cf_sexe").value="Homme",document.getElementById("cf_visited").checked=!1,document.getElementById("cf_quartier").value="",document.getElementById("cf_address").value="",document.getElementById("cf_produits").value="";const a=r.get("geo.position");document.getElementById("cf_lat").value=a?a.lat.toFixed(6):s.lat.toFixed(6),document.getElementById("cf_lon").value=a?a.lng.toFixed(6):s.lng.toFixed(6)}ut(),mt(),vt(),gt(),t.style.display="flex",S(),z()}function ut(){const e=document.getElementById("cf_quartier_chips");if(!e)return;const t=r.get("points")||[],n=new Map;t.forEach(a=>{const c=(a.quartier||"").trim();c&&n.set(c,(n.get(c)||0)+1)});const i=(r.get("targetZones")||[]).map(a=>a.name),o=[...n.entries()].sort((a,c)=>c[1]-a[1]).map(([a])=>a).filter(a=>!i.includes(a)),s=[...i,...o].slice(0,10);e.innerHTML=s.map(a=>{const c=i.includes(a);return`<button type="button" class="chip-q" data-q="${ke(a)}">${c?"🎯 ":""}${ke(a)}</button>`}).join(""),e.querySelectorAll(".chip-q").forEach(a=>{a.addEventListener("click",()=>{document.getElementById("cf_quartier").value=a.dataset.q,S(),z()})})}function ke(e){const t=document.createElement("div");return t.textContent=e,t.innerHTML}async function z(){var a,c,m;const e=document.getElementById("cf_proximity_warning");if(!e)return;const t=parseFloat((a=document.getElementById("cf_lat"))==null?void 0:a.value),n=parseFloat((c=document.getElementById("cf_lon"))==null?void 0:c.value),i=((m=document.getElementById("cf_id"))==null?void 0:m.value)||null;if(Number.isNaN(t)||Number.isNaN(n)){e.style.display="none";return}const o=await Ue(t,n,25,i);if(o.length===0){e.style.display="none";return}const s=o.slice(0,3).map(l=>l.name||`Fiche #${l.order||l.id}`).join(", ");e.style.display="block",e.textContent=`⚠️ ${o.length} fiche(s) déjà enregistrée(s) à moins de 25m de cette position (${s}). Vérifiez qu'il ne s'agit pas d'un doublon avant d'enregistrer.`}async function ie(){const e=document.getElementById("cf_name"),t=document.getElementById("cf_tel");if(e&&e.value.trim()&&t&&t.value.trim()&&!await de("Fermer sans enregistrer ?","Des données ont été saisies mais non enregistrées. Voulez-vous vraiment fermer ?"))return;const n=document.getElementById("censusFormModal");n&&(n.style.display="none")}function pt(){var n,i,o,s,a,c,m,l,d,v,b,h;(n=document.getElementById("censusFormCloseBtn"))==null||n.addEventListener("click",()=>ie()),(i=document.getElementById("censusModalBackdrop"))==null||i.addEventListener("click",()=>ie()),(o=document.getElementById("censusForm"))==null||o.addEventListener("focusin",u=>{u.target.matches("input, textarea, select")&&setTimeout(()=>{u.target.scrollIntoView({block:"center",behavior:"smooth"})},300)}),(s=document.getElementById("censusForm"))==null||s.addEventListener("keydown",u=>{var k;if(u.key!=="Enter"||!u.target.matches('input[type="text"], input[type="tel"]'))return;u.preventDefault();const g=[...u.currentTarget.querySelectorAll('input[type="text"], input[type="tel"], button.chip-a')],B=g.indexOf(u.target);(k=g[B+1])==null||k.focus()}),(a=document.getElementById("cf_name"))==null||a.addEventListener("input",S),(c=document.getElementById("cf_tel"))==null||c.addEventListener("input",u=>{u.target.value=ue(u.target.value),S()}),(m=document.getElementById("cf_quartier"))==null||m.addEventListener("input",S);const e=document.querySelectorAll("#cf_sexe_group .segment-btn");e.forEach(u=>{u.addEventListener("click",()=>{e.forEach(g=>g.classList.remove("active")),u.classList.add("active"),document.getElementById("cf_sexe").value=u.dataset.sexe})});const t=document.querySelectorAll("#cf_activity_group .chip-a");t.forEach(u=>{u.addEventListener("click",()=>{t.forEach(g=>g.classList.remove("active")),u.classList.add("active"),document.getElementById("cf_activity").value=u.dataset.activity,S()})}),document.querySelectorAll(".chip-p").forEach(u=>{u.addEventListener("click",()=>{u.classList.toggle("active"),ft()})}),(l=document.getElementById("cf_capture_gps"))==null||l.addEventListener("click",()=>{if(!navigator.geolocation){P("Géolocalisation non disponible");return}const u=document.getElementById("cf_capture_gps");u.textContent="⌛ Acquisition...",navigator.geolocation.getCurrentPosition(g=>{document.getElementById("cf_lat").value=g.coords.latitude.toFixed(6),document.getElementById("cf_lon").value=g.coords.longitude.toFixed(6),u.textContent="📍 Capturé !",setTimeout(()=>{u.textContent="📍 Ma Position GPS"},2e3),z()},g=>{u.textContent="⚠️ Erreur GPS",setTimeout(()=>{u.textContent="📍 Ma Position GPS"},2e3)},{enableHighAccuracy:!0,timeout:15e3})}),(d=document.getElementById("cf_lat"))==null||d.addEventListener("change",z),(v=document.getElementById("cf_lon"))==null||v.addEventListener("change",z),(b=document.getElementById("cf_ai_fix"))==null||b.addEventListener("click",()=>{const u=document.getElementById("cf_name"),g=document.getElementById("cf_tel"),B=document.getElementById("cf_address");u.value&&(u.value=u.value.split(" ").map(x=>x.charAt(0).toUpperCase()+x.slice(1).toLowerCase()).join(" ")),g.value&&(g.value=ue(g.value)),B.value&&(B.value=B.value.trim()),S();const k=document.getElementById("censusValidationBar");k&&(k.className="census-val-bar val-success",document.getElementById("censusValStatusIcon").textContent="✨",document.getElementById("censusValStatusText").textContent="Champs formatés avec succès !")}),(h=document.getElementById("censusForm"))==null||h.addEventListener("submit",async u=>{if(u.preventDefault(),!S()){P("Veuillez remplir correctement les champs obligatoires (Nom, Téléphone et Type d'activité).");return}const g=document.getElementById("cf_id").value,B=g?(r.get("points")||[]).find(N=>N.id===g):null,k={id:g||void 0,name:document.getElementById("cf_name").value.trim(),tel:document.getElementById("cf_tel").value.trim(),etablissement:document.getElementById("cf_etablissement").value.trim(),activityType:document.getElementById("cf_activity").value,status:B?B.status:"NON DEFINI",sexe:document.getElementById("cf_sexe").value,visited:document.getElementById("cf_visited").checked,quartier:document.getElementById("cf_quartier").value.trim(),address:document.getElementById("cf_address").value.trim(),produits:document.getElementById("cf_produits").value.trim(),lat:parseFloat(document.getElementById("cf_lat").value)||E.MAP_CENTER[0],lon:parseFloat(document.getElementById("cf_lon").value)||E.MAP_CENTER[1]},x=await Ze(k),$=r.get("points")||[],R=$.findIndex(N=>N.id===x.id);R>=0?$[R]=x:$.push(x),r.set("points",$);const F=new Set(r.get("sync.pendingPointIds")||[]);F.add(x.id),r.set("sync.pendingPointIds",[...F]),Re(x),Te(g?"Fiche modifiée avec succès.":"Nouvelle fiche enregistrée."),ie()})}function mt(){const e=document.getElementById("cf_sexe").value;document.querySelectorAll("#cf_sexe_group .segment-btn").forEach(t=>{t.classList.toggle("active",t.dataset.sexe===e)})}function vt(){const e=document.getElementById("cf_activity").value;document.querySelectorAll("#cf_activity_group .chip-a").forEach(t=>{t.classList.toggle("active",t.dataset.activity===e)})}function gt(){const e=document.getElementById("cf_produits").value||"";document.querySelectorAll("#cf_produits_group .chip-p").forEach(t=>{t.classList.toggle("active",e.includes(t.dataset.p))})}function ft(){const e=[];document.querySelectorAll("#cf_produits_group .chip-p.active").forEach(t=>{e.push(t.dataset.p)}),document.getElementById("cf_produits").value=e.join(", ")}function ue(e){const t=(e||"").replace(/\D/g,"");if(!t)return"";let n=t.slice(0,10);const i=[];for(let o=0;o<n.length;o+=2)i.push(n.slice(o,o+2));return i.join(" ")}function S(){var h,u,g;const e=((h=document.getElementById("cf_name"))==null?void 0:h.value.trim())||"",t=(((u=document.getElementById("cf_tel"))==null?void 0:u.value)||"").replace(/\D/g,""),n=((g=document.getElementById("cf_activity"))==null?void 0:g.value)||"",i=document.getElementById("cf_name_val"),o=document.getElementById("cf_name_err"),s=document.getElementById("cf_tel_val"),a=document.getElementById("cf_tel_err"),c=e.length>=2,m=t.length===10,l=n.length>0;i&&(c?(i.className="input-val-badge valid",i.textContent="✓ OK",o&&(o.style.color="#16a34a")):(i.className="input-val-badge invalid",i.textContent="⚠️ Requis",o&&(o.style.color="#dc2626"))),s&&(m?(s.className="input-val-badge valid",s.textContent="✓ 10 Chiffres",a&&(a.style.color="#16a34a")):t.length>0?(s.className="input-val-badge invalid",s.textContent=`${t.length}/10`,a&&(a.style.color="#eab308")):(s.className="input-val-badge invalid",s.textContent="⚠️ Requis",a&&(a.style.color="#dc2626")));const d=document.getElementById("censusValidationBar"),v=document.getElementById("censusValStatusIcon"),b=document.getElementById("censusValStatusText");return c&&m&&l?(d&&(d.className="census-val-bar val-success"),v&&(v.textContent="✅"),b&&(b.textContent="Fiche à 100% valide — Prête à être enregistrée !"),!0):(d&&(d.className="census-val-bar val-warning"),v&&(v.textContent="⚠️"),b&&(b.textContent="Saisie incomplète : vérifiez le Nom, le Numéro (10 chiffres) et le Type d'activité."),!1)}const oe=new Map,I=new Map,$e=[],se=[];let _=null,L=null,G=null,Z=null,Q=[];function bt(e){const n=e.currentTarget._pointId;if(!n)return;e.stopPropagation();const i=r.get("points").find(a=>a.id===n);if(!i)return;X();const o=Ne(i);_=o,L=n,o.addTo(q()),o.on("close",()=>{_===o&&(_=null,L=null)});const s=I.get(n);s&&(s.popup=o)}let Me=new Set;r.subscribe("sync.pendingPointIds",e=>{Me=new Set(e||[]),I.forEach((t,n)=>D(n))});function pe(e){return Me.has(e)}function me(e,t,n){const i=`${e}_${t}_${n}`;if(oe.has(i))return oe.get(i);const l=`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C6 0 0 6 0 13c0 9 13 21 13 21s13-12 13-21C26 6 20 0 13 0z"
      fill="${e}" fill-opacity="${t?.45:1}" stroke="${n?"#b5791a":t?"#555":"#222"}" stroke-width="1.5" ${n?'stroke-dasharray="3,2"':""}/>
    <circle cx="13" cy="13" r="5.5" fill="white" fill-opacity="${t?.85:1}"/>
    ${t?'<path d="M9 13l2.5 2.5L17 10" stroke="#2e7d32" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>':""}
    ${n?'<circle cx="20" cy="6" r="5.5" fill="#f4e3c4" stroke="#b5791a" stroke-width="1.2"/><text x="20" y="8.8" font-size="7" text-anchor="middle">⏳</text>':""}
  </svg>`;return oe.set(i,l),l}function Pe(e){const t=E.STATUS_COLORS[e.status]||"#95a5a6",n=E.STATUS_TEXT_COLORS[e.status]||"#566573",i=r.get("geo.position");let o="";if(i&&e.lat!=null&&e.lon!=null){const v=Ke(i.lat,i.lng,e.lat,e.lon);o=`<div class="popup-dist">📍 ${xt(v)} de vous</div>`}const s=e.tel?`<a href="tel:${y(e.tel)}" style="color:#166534; font-weight:700; text-decoration:none; background:#f0fdf4; padding:2px 8px; border-radius:6px; border:1px solid #bbf7d0;">📞 ${y(e.tel)}</a>`:"—",a=y(e.id),c=e.lat!=null?e.lat.toFixed(6):"—",m=e.lon!=null?e.lon.toFixed(6):"—",l=e.updatedAt?new Date(e.updatedAt).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—",d=document.createElement("div");return d.innerHTML=`
    <div class="popup-title">${y(e.order)}. ${y(e.name||"(sans nom)")}${e.visited?' <span style="color:#15803d; font-size:12px;">✓ Visité</span>':""}</div>
    <div class="popup-row"><b>Bloc:</b> ${String(e.block).padStart(2,"0")} — Ordre ${y(e.order)}</div>
    <div class="popup-row"><b>Téléphone:</b> ${s}</div>
    <div class="popup-row"><b>Quartier:</b> ${y(e.quartier||"—")}</div>
    <div class="popup-row"><b>Adresse:</b> ${y(e.address||"—")}</div>
    <div class="popup-row"><b>Établissement:</b> ${y(e.etablissement||"—")}</div>
    <div class="popup-row"><b>Type d'activité:</b> ${y(e.activityType||"—")}</div>
    <div class="popup-row"><b>Produits:</b> ${y(e.produits||"—")}</div>
    <div class="popup-row"><b>Sexe:</b> ${y(e.sexe||"—")}</div>
    <div class="popup-row popup-coords">📍 ${c}, ${m}</div>
    <div class="popup-row popup-updated">🗓️ Mis à jour: ${l}</div>
    <div class="popup-status" style="background:${t}22;color:${n};border:1px solid ${t}">${y(e.status)}</div>
    ${o}
    <div class="btn-row">
      <button class="go-btn" data-action="route" data-id="${a}">🧭 Itinéraire</button>
      <button class="go-btn nav-btn" data-action="navigate" data-id="${a}">🗺️ Naviguer</button>
    </div>
    <div class="btn-row">
      <button class="visit-btn ${e.visited?"btn-unvisit":"btn-visit"}" data-action="visit" data-id="${a}">
        ${e.visited?"🔄 Annuler la visite":"✅ Marquer comme visité"}
      </button>
      <button class="go-btn edit-btn" data-action="edit" data-id="${a}" style="background:#475569;">✏️ Éditer</button>
    </div>
  `,d.querySelectorAll("[data-action]").forEach(v=>{v.addEventListener("click",yt)}),d}function yt(e){const t=e.currentTarget,n=t.dataset.action,i=t.dataset.id,o=r.get("points").find(s=>s.id===i);o&&(n==="route"||n==="navigate"?(r.set("navigation.destination",o),r.set("navigation.active",!0)):n==="visit"?ht(o):n==="edit"&&J(o))}async function ht(e){const t=!e.visited;await we(e.id,t,e.status);const n=r.get("points").map(i=>i.id===e.id?{...i,visited:t}:i);r.set("points",n),D(e.id)}function X(){_&&(_.remove(),_=null,L=null)}function Ne(e){const t=new W.Popup({offset:[0,-30],closeButton:!0,maxWidth:"min(92vw, 340px)",closeOnClick:!1});return t.setDOMContent(Pe(e)),t}function Et(){const e=$e.pop();if(e)return e;const t=document.createElement("div");return t.className="pin-hit",t.style.cursor="pointer",t.addEventListener("click",bt),{el:t,marker:new W.Marker({element:t,anchor:"bottom"})}}function qe(e){e.popup&&e.popup===_&&(e.popup.remove(),_=null,L=null),e.popup=null,e.marker.remove(),e.el._pointId=null,$e.push({marker:e.marker,el:e.el})}function ve(){const e=q(),t=ge();if(!e||!t)return;const n=e.getBounds(),i=e.getZoom(),o=[n.getWest(),n.getSouth(),n.getEast(),n.getNorth()],s=t.getClusters(o,i);for(const l of se)l.remove();se.length=0;const a=r.get("points")||[],c=new Map(a.map(l=>[l.id,l])),m=new Set;for(const l of s)l.properties.cluster||m.add(l.properties.id);_&&L&&!m.has(L)&&X();for(const[l,d]of I)m.has(l)||(qe(d),I.delete(l));for(const l of s){const d=l.properties;if(d.cluster){const v=document.createElement("div");v.className="cluster-marker",v.textContent=d.point_count;const b=new W.Marker({element:v,anchor:"center"}).setLngLat(l.geometry.coordinates).addTo(e);se.push(b),v.addEventListener("click",()=>{e.easeTo({center:l.geometry.coordinates,zoom:Math.min(i+2,t.options.maxZoom+1),duration:400})})}else{const v=d.id,b=c.get(v);if(!b)continue;const h=I.get(v);if(h){const k=E.STATUS_COLORS[b.status]||"#95a5a6",x=me(k,b.visited,pe(v));h.el.innerHTML!==x&&(h.el.innerHTML=x),h.marker.setLngLat([b.lon,b.lat]);continue}const{marker:u,el:g}=Et(),B=E.STATUS_COLORS[b.status]||"#95a5a6";g.innerHTML=me(B,b.visited,pe(v)),g._pointId=v,u.setLngLat([b.lon,b.lat]),u.addTo(e),I.set(v,{marker:u,el:g,popup:null})}}}function j(e){const t=q(),n=ge();if(!(!t||!n)){for(const[,i]of I)qe(i);I.clear(),X(),Q=e.map(i=>({type:"Feature",geometry:{type:"Point",coordinates:[i.lon,i.lat]},properties:{...i}})),n.load(Q),G&&t.off("moveend",G),G=()=>{Z&&cancelAnimationFrame(Z),Z=requestAnimationFrame(()=>{Z=null,ve()})},t.on("moveend",G),ve()}}function Re(e){if(I.get(e.id)){D(e.id);return}const n=ge();n&&(Q.push({type:"Feature",geometry:{type:"Point",coordinates:[e.lon,e.lat]},properties:{...e}}),n.load(Q),ve())}function D(e){const t=I.get(e),n=r.get("points").find(s=>s.id===e);if(!t||!n)return;const i=E.STATUS_COLORS[n.status]||"#95a5a6",o=me(i,n.visited,pe(e));t.el.innerHTML!==o&&(t.el.innerHTML=o),t.popup&&t.popup.isOpen()&&t.popup.setDOMContent(Pe(n))}function Fe(e){const t=r.get("points").find(s=>s.id===e);if(!t)return;const n=q();X();const i=Ne(t);_=i,L=e,i.addTo(n),i.on("close",()=>{_===i&&(_=null,L=null)});const o=I.get(e);o&&(o.popup=i)}function Ve(){if(I.size===0||!q())return null;const t=new W.LngLatBounds;return I.forEach(n=>{t.extend(n.marker.getLngLat())}),[[t.getWest(),t.getSouth()],[t.getEast(),t.getNorth()]]}function xt(e){return e<1?Math.round(e*1e3)+" m":e.toFixed(1)+" km"}const Dt=Object.freeze(Object.defineProperty({__proto__:null,getFilteredBounds:Ve,openPopup:Fe,refreshMarker:D,renderMarkers:j,upsertMarker:Re},Symbol.toStringTag,{value:"Module"}));async function Bt(e,t,n,i){var s,a;const o=`${E.OSRM_URL}/route/v1/foot/${t},${e};${i},${n}?overview=full&geometries=geojson&steps=true`;try{const c=await fetch(o);if(!c.ok)throw new Error(`HTTP ${c.status}`);const m=await c.json();if(m.code!=="Ok"||!((s=m.routes)!=null&&s[0]))throw new Error("Itinéraire impossible");const l=m.routes[0];return{distance:l.distance,duration:l.duration,geometry:l.geometry,steps:((a=l.legs[0])==null?void 0:a.steps)||[]}}catch(c){throw console.error("Routing error:",c),c}}function It(e){Ae(),Je(e)}function ze(){Ae(),r.set("navigation.route",null),r.set("navigation.instruction","")}function kt(e){const t=Math.round(e/60);if(t<60)return`${t} min`;const n=Math.floor(t/60),i=t%60;return`${n}h ${i}min`}function Oe(e){return e<1e3?`${Math.round(e)} m`:`${(e/1e3).toFixed(1)} km`}let V=[];function _t(){V.forEach(e=>e()),V=[],V.push(r.subscribe("navigation.active",e=>{e?ae():ze()})),V.push(r.subscribe("navigation.destination",()=>{r.get("navigation.active")&&ae()})),V.push(r.subscribe("geo.position",e=>{!r.get("navigation.active")||!e||(r.get("navigation.route")?wt(e):ae())}))}async function ae(){const e=r.get("navigation.destination");if(!e)return;const t=r.get("geo.position");if(!t){r.set("navigation.instruction","📍 En attente de votre position GPS...");return}r.set("navigation.instruction","⏳ Calcul de l'itinéraire...");try{const n=await Bt(t.lat,t.lng,e.lat,e.lon);r.set("navigation.route",n),It(n.geometry),r.set("navigation.instruction",`${Oe(n.distance)} — ${kt(n.duration)}`)}catch{r.set("navigation.instruction","⚠️ Itinéraire indisponible — vérifiez votre connexion")}}function wt(e){const t=r.get("navigation.destination");if(!t)return;const n=Ct(e.lat,e.lng,t.lat,t.lon);if(n<=E.ARRIVAL_RADIUS_M){r.get("navigation.arrived")||(r.set("navigation.arrived",!0),r.set("navigation.instruction","🎉 Vous êtes arrivé !"));return}r.set("navigation.arrived",!1),r.set("navigation.instruction",`${Oe(n)} restants`)}async function At(){const e=r.get("navigation.destination");if(!e)return;await we(e.id,!0,e.status);const t=r.get("points").map(n=>n.id===e.id?{...n,visited:!0}:n);r.set("points",t),D(e.id),ze(),r.set("navigation.arrived",!1),r.set("navigation.active",!1)}function Ct(e,t,n,i){const s=(n-e)*Math.PI/180,a=(i-t)*Math.PI/180,c=Math.sin(s/2)**2+Math.cos(e*Math.PI/180)*Math.cos(n*Math.PI/180)*Math.sin(a/2)**2;return 6371e3*2*Math.atan2(Math.sqrt(c),Math.sqrt(1-c))}async function St(){try{const e=O(),{data:t,error:n}=await e.from("target_zones").select("id, name").order("name",{ascending:!0});if(n)throw n;return t||[]}catch(e){return console.warn("Zones cibles indisponibles (table pas encore créée ou hors-ligne) :",e.message),[]}}async function Tt(e){const t=(e||"").trim();if(!t)throw new Error("Nom de zone requis");const n=O(),{data:i,error:o}=await n.from("target_zones").insert({name:t}).select("id, name").single();if(o)throw o.code==="23505"?new Error("Cette zone existe déjà."):o;return i}async function Lt(e){const t=O(),{error:n}=await t.from("target_zones").delete().eq("id",e);if(n)throw n}let T=null;function je(){T&&(T.remove(),T=null)}let re=null;function K(){return re||(re=Ce(()=>import("./tour-BxCqfCRT.js"),__vite__mapDeps([0,1,2,3,4,5])).then(e=>(e.initTour(),e))),re}let ce=null;function M(){return ce||(ce=Ce(()=>import("./aiAgents-CYrZUDua.js"),__vite__mapDeps([6,1,2,3,4,5]))),ce}function $t(e,t){let n;return(...i)=>{clearTimeout(n),n=setTimeout(()=>e(...i),t)}}async function Mt(e){e.innerHTML=`
    <div id="app-container">
      <header>
        <div class="htitle">
          <span class="brand-mark">🗺️</span>
          <div>
            <h1>Recensement <span>ANAREKA-CI</span></h1>
            <div class="stats" id="statsHeader">Chargement...</div>
          </div>
        </div>
        <div class="right">
          <div id="syncStatus">🌐 Connexion...</div>
          <div class="header-actions">
            <button id="addCensusBtnHeader" class="btn-add-header" title="Nouveau point de recensement">➕ Saisie</button>
            <button id="aiModalBtnHeader" class="btn-ai-header" title="Assistant & Optimisation IA">🤖 Agents IA</button>
            <button id="logoutBtn" title="Déconnexion" aria-label="Déconnexion">🔒</button>
            <button id="menuToggleBtn" title="Filtres" aria-label="Filtres">☰</button>
          </div>
        </div>
      </header>

      <div id="controls">
        <div id="controlsInner">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">
            <span style="font-weight:700; font-size:14px; color:#1a3d2b; display:flex; align-items:center; gap:6px;">⚡ Options & Filtres</span>
            <button id="closeControlsBtn" aria-label="Fermer les filtres" style="background:#f5f5f5; border:none; width:44px; height:44px; border-radius:50%; font-size:14px; cursor:pointer; color:#666; display:flex; align-items:center; justify-content:center;">✕</button>
          </div>
          <div class="action-row" style="margin-bottom:10px; display:grid; grid-template-columns: 1fr 1.2fr; gap:8px;">
            <button id="addCensusBtnControl" class="btn-add-control">➕ Nouvel Établissement</button>
            <button id="aiModalBtnControl" class="btn-ai-control">🤖 Agents IA Copilot</button>
          </div>
          <div id="quartierCoveragePanel" style="margin:0 0 12px; padding:10px; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
            <div style="font-weight:700; font-size:12px; color:#1a3d2b; margin-bottom:6px;">📊 Couverture par quartier — priorité aux moins avancés</div>
            <div id="quartierCoverageList" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:5px;"></div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <input type="text" id="newZoneInput" placeholder="Ajouter une zone à couvrir (ville, quartier...)" style="flex:1; font-size:12px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px;" />
              <button type="button" id="addZoneBtn" style="font-size:12px; padding:6px 10px; border:none; border-radius:8px; background:#1a3d2b; color:white; cursor:pointer; white-space:nowrap;">➕ Ajouter</button>
            </div>
          </div>
          <div class="row2">
            <label>Bloc <select id="filterBlock"><option value="all">Tous</option></select></label>
            <label>Statut
              <select id="filterStatus">
                <option value="all">Tous</option>
                <option value="VERT (Joignable)">Vert</option>
                <option value="JAUNE (Injoignable)">Jaune</option>
                <option value="ROUGE (Refus)">Rouge</option>
                <option value="VIOLET (A verifier)">Violet</option>
                <option value="NON DEFINI">Non défini</option>
              </select>
            </label>
          </div>
          <div class="row2">
            <label>Visite
              <select id="filterVisited">
                <option value="all">Tous</option>
                <option value="no">Non visités</option>
                <option value="yes">Déjà visités</option>
              </select>
            </label>
            <label>Recherche <input type="text" id="searchBox" placeholder="Nom, quartier, tel..."></label>
          </div>
          <div class="action-row">
            <button id="locateBtn" class="btn-locate">📍 Me localiser</button>
            <button id="nearestBtn" class="btn-nearest">🏃 Plus proche</button>
          </div>
          <div class="action-row">
            <button id="tourBtn" class="btn-tour" disabled>🗺️ Tournée optimisée</button>
          </div>
          <div class="action-row">
            <button id="fitFilteredBtn" class="btn-overview">👁️ Vue d'ensemble filtrés</button>
          </div>
          <div class="action-row" id="adminTrackingRow" style="display:none;">
            <button id="agentTrackingBtn" class="btn-ai-control">📍 Suivi Agents Terrain</button>
          </div>
          <div class="action-row">
            <button id="exportBtn" class="btn-export">📄 Exporter CSV</button>
            <button id="resetBtn" class="btn-reset">🔄 Réinitialiser</button>
          </div>
          <div id="geoStatus"></div>
        </div>
      </div>

      <div id="main">
        <div id="map"></div>
        
        <div id="navPanel">
          <div id="navIcon">🧭</div>
          <div id="navInfo">
            <div id="navInstruction">—</div>
            <div id="navSub"></div>
          </div>
          <button id="navStopBtn" aria-label="Arrêter la navigation">✕</button>
        </div>
        
        <div id="arrivalBanner">
          <div id="arrivalText">🎉 Vous êtes arrivé !</div>
          <div class="arrival-row">
            <button class="arrival-yes" id="arrivalYesBtn">✅ Marquer visité</button>
            <button class="arrival-no" id="arrivalNoBtn">Fermer</button>
          </div>
        </div>
        
        <div id="routeBanner">
          <span>🗺️ Itinéraire vers <b id="routeDestName"></b> — <span id="routeInfo"></span></span>
          <button id="closeRouteBtn" aria-label="Fermer l'itinéraire">✕</button>
        </div>
        
        <button id="fabNearest">🏃 Point le plus proche</button>
        <button id="fabAdd" aria-label="Ajouter un point de recensement">➕</button>
        
        <div class="legend">
          <div><b>Statut</b></div>
          <div><span class="dot" style="background:#2ecc71"></span>Vert</div>
          <div><span class="dot" style="background:#f1c40f"></span>Jaune</div>
          <div><span class="dot" style="background:#e74c3c"></span>Rouge</div>
          <div><span class="dot" style="background:#9b59b6"></span>Violet</div>
          <div><span class="dot" style="background:#95a5a6"></span>Non défini</div>
          <div style="margin-top:5px;border-top:1px solid #ddd;padding-top:5px">
            <span style="opacity:0.5">✓</span> visité
          </div>
        </div>
        
        <div id="loading">Chargement de la carte...</div>
        
        <div id="tourPanel">
          <div class="tour-handle"></div>
          <div class="tour-header">
            <div>
              <div class="tour-title">🗺️ Tournée optimisée</div>
              <div id="tourProgress" class="tour-progress">—</div>
            </div>
            <button id="tourCloseBtn" aria-label="Fermer">✕</button>
          </div>
          <div id="tourSummary" class="tour-summary">—</div>
          <button id="tourGoNextBtn" class="tour-go-next">➡️ Naviguer vers le prochain arrêt</button>
          <div id="tourList" class="tour-list"></div>
        </div>

        <div id="aiModal" class="ai-modal" role="dialog" aria-modal="true" aria-label="Assistant IA" style="display:none;">
          <div class="ai-modal-backdrop" id="aiModalBackdrop"></div>
          <div class="ai-modal-card">
            <div class="ai-modal-header">
              <div class="ai-modal-title">
                <span class="ai-badge-icon">🤖</span>
                <div>
                  <h3>Suite d'Agents IA ANAREKA-CI</h3>
                  <p>Copilot, Vision OCR, Dictée Vocale & Briefing</p>
                </div>
              </div>
              <button id="aiModalCloseBtn" class="ai-close-btn" aria-label="Fermer l'assistant IA">✕</button>
            </div>

            <div class="ai-tabs">
              <button class="ai-tab active" data-tab="copilot">💬 Copilot</button>
              <button class="ai-tab" data-tab="strategist">⚡ Strategist</button>
              <button class="ai-tab" data-tab="voice">🎙️ Dictée</button>
              <button class="ai-tab" data-tab="vision">📸 Photo OCR</button>
              <button class="ai-tab" data-tab="briefing">📊 Briefing</button>
            </div>

            <div class="ai-content-body">
              <div id="aiTabCopilot" class="ai-tab-pane active">
                <div class="ai-prompt-box">
                  <input type="text" id="aiCopilotInput" placeholder="Posez une question sur votre secteur..." />
                  <button id="aiCopilotSendBtn" class="btn-ai-send">Envoyer</button>
                </div>
                <div class="ai-quick-prompts">
                  <button class="chip-prompt" data-prompt="Quelles sont les priorités de recensement ce matin ?">🎯 Priorités</button>
                  <button class="chip-prompt" data-prompt="Donne-moi une synthèse de l'avancement global du recensement.">📊 Synthèse</button>
                  <button class="chip-prompt" data-prompt="Quels sont les ménages injoignables à relancer ?">📞 Relances</button>
                </div>
              </div>

              <div id="aiTabStrategist" class="ai-tab-pane" style="display:none;">
                <p class="ai-pane-desc">L'Agent Strategist analyse vos points géolocalisés pour optimiser votre itinéraire et vos créneaux d'accès.</p>
                <button id="aiRunStrategistBtn" class="btn-ai-action">⚡ Générer la stratégie de tournée IA</button>
                <button id="aiRunAuditBtn" class="btn-ai-action-secondary" style="margin-top:6px;">🔍 Lancer l'audit de qualité des données</button>
              </div>

              <div id="aiTabVoice" class="ai-tab-pane" style="display:none;">
                <p class="ai-pane-desc">Dictez votre rapport de visite à haute voix ou tapez vos notes brutes. L'Agent IA extraira automatiquement le nom, téléphone et statut.</p>
                <div class="ai-voice-container">
                  <button id="aiMicBtn" class="btn-mic">🎙️ Démarrer la dictée vocale</button>
                  <span id="aiMicStatus" class="mic-status">Prêt</span>
                </div>
                <textarea id="aiVoiceNoteText" placeholder="Ou saisissez la note vocale ici (ex: Visite point 12, M. Yao Kouadio, tel 0708091011, statut vert)..." rows="3"></textarea>
                <button id="aiParseVoiceBtn" class="btn-ai-action">✨ Analyser et structurer la note avec Gemini</button>
              </div>

              <div id="aiTabVision" class="ai-tab-pane" style="display:none;">
                <p class="ai-pane-desc">Prenez ou téléchargez une photo du compteur d'électricité/eau ou du badge pour extraction automatique par Gemini Vision.</p>
                <div class="ai-vision-upload">
                  <input type="file" id="aiImageInput" accept="image/*" style="display:none;" />
                  <button id="aiSelectImageBtn" class="btn-vision-select">📷 Sélectionner / Prendre une photo</button>
                  <div id="aiImagePreview" class="ai-img-preview" style="display:none;"></div>
                </div>
                <button id="aiRunVisionBtn" class="btn-ai-action" style="display:none; margin-top:10px;">🔍 Analyser la photo avec Gemini Vision</button>
              </div>

              <div id="aiTabBriefing" class="ai-tab-pane" style="display:none;">
                <p class="ai-pane-desc">Obtenez un briefing IA personnalisé basé sur la météo terrain, la progression et les objectifs prioritaires.</p>
                <button id="aiRunBriefingBtn" class="btn-ai-action">📋 Générer mon Briefing IA du Jour</button>
              </div>

              <div id="aiAgentOutput" class="ai-output-box" style="display:none;">
                <div id="aiOutputText" class="ai-output-text"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,await Pt()}function A(){var e;(e=document.getElementById("controls"))==null||e.classList.remove("open")}async function Pt(){var n;Qe("map"),_t(),dt();const e=await Se();j(e),Vt(e),fe(),r.set("targetZones",await St()),ee();const t=document.getElementById("loading");if(t&&(t.style.display="none"),e.length===0){const i=document.getElementById("main");i&&!T&&(T=document.createElement("div"),T.className="empty-state",T.innerHTML=`
        <div class="empty-state-icon">📍</div>
        <div class="empty-state-title">Aucun point de recensement</div>
        <div class="empty-state-desc">Commencez par ajouter le premier établissement de votre zone en utilisant le bouton + ci-dessus.</div>
        <button class="empty-state-btn" id="emptyAddBtn">➕ Ajouter un point</button>
      `,i.appendChild(T),(n=document.getElementById("emptyAddBtn"))==null||n.addEventListener("click",()=>J()))}else je();document.getElementById("tourBtn").disabled=!1,document.getElementById("nearestBtn").disabled=!1;try{const i=r.get("user"),o=O(),{data:s}=await o.from("user_roles").select("role").eq("user_id",i.id).maybeSingle(),a=(s==null?void 0:s.role)==="admin",c=document.getElementById("adminTrackingRow");c&&(c.style.display=a?"flex":"none")}catch{}Nt(),Rt()}function Nt(){var n,i,o,s,a,c,m,l;document.getElementById("logoutBtn").onclick=async()=>{await de("Déconnexion","Voulez-vous vous déconnecter ? Les données non synchronisées seront conservées localement.")&&We()},document.getElementById("menuToggleBtn").onclick=()=>{document.getElementById("controls").classList.toggle("open")};const e=()=>{J(),A()};(n=document.getElementById("addCensusBtnHeader"))==null||n.addEventListener("click",e),(i=document.getElementById("addCensusBtnControl"))==null||i.addEventListener("click",e),(o=document.getElementById("closeControlsBtn"))==null||o.addEventListener("click",()=>{A()}),document.addEventListener("click",d=>{const v=document.getElementById("controls"),b=document.getElementById("menuToggleBtn");v&&v.classList.contains("open")&&!v.contains(d.target)&&!b.contains(d.target)&&A()}),["filterBlock","filterStatus","filterVisited"].forEach(d=>{var v;(v=document.getElementById(d))==null||v.addEventListener("change",()=>le())}),(s=document.getElementById("searchBox"))==null||s.addEventListener("input",$t(()=>le(),250)),document.getElementById("locateBtn").onclick=()=>{Ye(),A()},document.getElementById("nearestBtn").onclick=async()=>{const d=await Xe();d?(et(d.point.lat,d.point.lon,17),Fe(d.point.id)):ne("Aucun point non-visité trouvé."),A()},document.getElementById("fabNearest").onclick=()=>document.getElementById("nearestBtn").click(),(a=document.getElementById("fabAdd"))==null||a.addEventListener("click",()=>{J(),A()}),document.getElementById("fitFilteredBtn").onclick=()=>{const d=Ve();d?tt(d):P("Aucun point ne correspond aux filtres."),A()};let t=!1;(c=document.getElementById("agentTrackingBtn"))==null||c.addEventListener("click",async()=>{t=!t;const d=document.getElementById("agentTrackingBtn");t?(nt(),d&&(d.textContent="📍 Arrêter le suivi")):(it(),d&&(d.textContent="📍 Suivi Agents Terrain")),A()}),document.getElementById("tourBtn").onclick=async()=>{let d=r.get("geo.position");if(d||(d=ot(),d&&r.set("geo.position",d)),!d){P("Position GPS indisponible pour le moment. Réessayez dans quelques secondes.");return}const v=r.get("points").filter(g=>!g.visited),{generateOptimizedTour:b,startTour:h}=await K(),u=b(v,{lat:d.lat,lng:d.lng});if(u.length===0){ne("Tous les points non-visités ont déjà été traités !");return}h(u),A()},document.getElementById("tourGoNextBtn").onclick=async()=>(await K()).goToNext(),document.getElementById("tourCloseBtn").onclick=async()=>(await K()).stopTour(),document.getElementById("exportBtn").onclick=()=>zt(),(m=document.getElementById("addZoneBtn"))==null||m.addEventListener("click",async()=>{const d=document.getElementById("newZoneInput"),v=d==null?void 0:d.value.trim();if(v)try{const b=await Tt(v);r.set("targetZones",[...r.get("targetZones")||[],b]),ee(),d.value="",ne(`"${v}" ajoutée aux zones à couvrir.`)}catch(b){Le(b.message||"Impossible d'ajouter cette zone.")}}),(l=document.getElementById("newZoneInput"))==null||l.addEventListener("keydown",d=>{var v;d.key==="Enter"&&((v=document.getElementById("addZoneBtn"))==null||v.click())}),document.getElementById("resetBtn").onclick=async()=>{if(await de("Réinitialiser les visites","Toutes les visites enregistrées seront supprimées LOCALEMENT et sur le serveur. Cette action est irréversible.",{danger:!0})){await st(),(await at()).synced||P("Visites réinitialisées localement. Le reset serveur échouera en ligne — réessayez plus tard.");const b=await Se();j(b),fe();const h=document.getElementById("filterVisited");h&&(h.value="all"),le(),Te("Toutes les visites ont été réinitialisées.")}},document.getElementById("closeRouteBtn").onclick=()=>{r.set("navigation.active",!1)},document.getElementById("navStopBtn").onclick=()=>{r.set("navigation.active",!1)},document.getElementById("arrivalYesBtn").onclick=()=>At(),document.getElementById("arrivalNoBtn").onclick=()=>{document.getElementById("arrivalBanner").style.display="none"},qt()}function qt(){var B,k,x,$,R,F,N,be,ye,he;const e=()=>{document.getElementById("aiModal").style.display="block",A()},t=()=>{document.getElementById("aiModal").style.display="none"};(B=document.getElementById("aiModalBtnHeader"))==null||B.addEventListener("click",e),(k=document.getElementById("aiModalBtnControl"))==null||k.addEventListener("click",e),(x=document.getElementById("aiModalCloseBtn"))==null||x.addEventListener("click",t),($=document.getElementById("aiModalBackdrop"))==null||$.addEventListener("click",t);const n=document.querySelectorAll(".ai-tab");n.forEach(p=>{p.addEventListener("click",()=>{n.forEach(w=>w.classList.remove("active")),p.classList.add("active");const f=p.dataset.tab;document.getElementById("aiTabCopilot").style.display=f==="copilot"?"block":"none",document.getElementById("aiTabStrategist").style.display=f==="strategist"?"block":"none",document.getElementById("aiTabVoice").style.display=f==="voice"?"block":"none",document.getElementById("aiTabVision").style.display=f==="vision"?"block":"none",document.getElementById("aiTabBriefing").style.display=f==="briefing"?"block":"none"})});const i=p=>{const f=document.getElementById("aiAgentOutput"),w=document.getElementById("aiOutputText");f&&(f.style.display="block"),w&&(w.innerHTML=p)},o=p=>(p||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\*\*(.*?)\*\*/g,"<b>$1</b>").replace(/\*(.*?)\*/g,"<i>$1</i>").replace(/\n/g,"<br>"),s=async p=>{if(!(!p||!p.trim())){i("⏳ <i>L'Agent Copilot IA réfléchit...</i>");try{const f=r.get("points")||[],w=r.get("geo.position"),H=await(await M()).askAiAgent("copilot",{prompt:p,points:f,userPos:w});i(o(H.text))}catch(f){i(`❌ <i>Erreur : ${y(f.message||"Impossible de contacter l'agent IA")}</i>`)}}};(R=document.getElementById("aiCopilotSendBtn"))==null||R.addEventListener("click",()=>{const p=document.getElementById("aiCopilotInput");p&&(s(p.value),p.value="")}),(F=document.getElementById("aiCopilotInput"))==null||F.addEventListener("keydown",p=>{if(p.key==="Enter"){const f=document.getElementById("aiCopilotInput");f&&(s(f.value),f.value="")}}),document.querySelectorAll(".chip-prompt").forEach(p=>{p.addEventListener("click",()=>{s(p.dataset.prompt)})}),(N=document.getElementById("aiRunStrategistBtn"))==null||N.addEventListener("click",async()=>{i("⏳ <i>L'Agent Strategist analyse votre secteur...</i>");try{const p=r.get("points")||[],f=r.get("geo.position"),w=await(await M()).askAiAgent("optimize_tour",{points:p,userPos:f});i(o(w.text))}catch(p){i(`❌ <i>Erreur : ${y(p.message||"Échec de l'analyse")}</i>`)}}),(be=document.getElementById("aiRunAuditBtn"))==null||be.addEventListener("click",async()=>{i("⏳ <i>L'Agent Audit vérifie la qualité des données...</i>");try{const p=r.get("points")||[],f=await(await M()).askAiAgent("audit_quality",{points:p});i(o(f.text))}catch(p){i(`❌ <i>Erreur : ${y(p.message||"Échec de l'audit")}</i>`)}});let a=null;const c=document.getElementById("aiMicBtn"),m=document.getElementById("aiMicStatus"),l=document.getElementById("aiVoiceNoteText");c&&c.addEventListener("click",async()=>{if(!a){const{createSpeechRecognizer:p}=await M();a=p(f=>{l&&(l.value=(l.value?l.value+" ":"")+f),m&&(m.textContent="✅ Transcrit !"),c&&c.classList.remove("recording")},f=>{console.warn("Erreur dictée vocale:",f),m&&(m.textContent="⚠️ Dictée vocale non disponible sur ce navigateur"),c&&c.classList.remove("recording")},()=>{c&&c.classList.remove("recording")})}if(a)try{a.start(),m&&(m.textContent="🔴 Écoute en cours... Parlez !"),c.classList.add("recording")}catch(p){console.warn(p)}else m&&(m.textContent="⚠️ Saisissez directement le texte ci-dessous.")}),(ye=document.getElementById("aiParseVoiceBtn"))==null||ye.addEventListener("click",async()=>{const p=l==null?void 0:l.value;if(!p||!p.trim()){P("Veuillez d'abord dicter ou taper une note vocale.");return}i("⏳ <i>L'Agent Transcripteur IA analyse et extrait les données...</i>");try{const f=await(await M()).askAiAgent("parse_voice_note",{prompt:p});i(o(f.text))}catch(f){i(`❌ <i>Erreur : ${y(f.message||"Échec de l'analyse vocale")}</i>`)}});let d=null,v="image/jpeg";const b=document.getElementById("aiSelectImageBtn"),h=document.getElementById("aiImageInput"),u=document.getElementById("aiImagePreview"),g=document.getElementById("aiRunVisionBtn");b==null||b.addEventListener("click",()=>h==null?void 0:h.click()),h==null||h.addEventListener("change",p=>{var w;const f=(w=p.target.files)==null?void 0:w[0];if(f){v=f.type||"image/jpeg";const H=new FileReader;H.onload=De=>{d=De.target.result,u&&(u.style.display="block",u.innerHTML=`<img src="${d}" style="max-width:100%; max-height:180px; border-radius:10px; margin-top:8px; border:1px solid #ddd;" />`),g&&(g.style.display="block")},H.readAsDataURL(f)}}),g==null||g.addEventListener("click",async()=>{if(d){i("⏳ <i>L'Agent Vision Reconnaissance Gemini analyse la photo...</i>");try{const p=await(await M()).askAiAgent("vision_ocr",{imageBase64:d,mimeType:v});i(o(p.text))}catch(p){i(`❌ <i>Erreur : ${y(p.message||"Échec de l'analyse photo")}</i>`)}}}),(he=document.getElementById("aiRunBriefingBtn"))==null||he.addEventListener("click",async()=>{i("⏳ <i>Préparation de votre Briefing IA Matinal...</i>");try{const p=r.get("points")||[],f=await(await M()).askAiAgent("daily_briefing",{points:p});i(o(f.text))}catch(p){i(`❌ <i>Erreur : ${y(p.message||"Échec du briefing")}</i>`)}})}function Rt(){r.subscribe("points",n=>{fe(),ee(),n&&n.length>0&&(je(),j(n))});const e=()=>{const n=document.getElementById("syncStatus");if(!n)return;const i=r.get("sync.status"),o=r.get("sync.deadCount")||0,s=r.get("sync.pendingCount")||0;if(o>0){n.textContent=`⚠️ ${o} fiche${o>1?"s":""} bloquée${o>1?"s":""} — Voir`,n.title="Ces fiches n'ont pas pu être envoyées après plusieurs tentatives. Cliquez pour voir les détails.",n.style.cursor="pointer",n.onclick=async()=>{P(`${o} fiche(s) bloquée(s). Nouvelle tentative en cours...`),await rt()};return}n.onclick=null,n.style.cursor="default";const a={idle:"🟢 Synchronisé",offline:"📴 Mode offline",error:"⚠️ Erreur sync"};i==="syncing"&&s>0?n.textContent=`🔄 Sync... ${s} restante${s>1?"s":""}`:n.textContent=a[i]||i};r.subscribe("sync.status",e),r.subscribe("sync.deadCount",e),r.subscribe("sync.pendingCount",e);const t=()=>{const n=document.getElementById("geoStatus");if(!n)return;const i=r.get("geo.error"),o=r.get("geo.tracking"),s=r.get("geo.position");i?(n.textContent=`⚠️ ${i}`,n.className="geo-status geo-status-error"):o&&s?(n.textContent="📍 Position GPS active",n.className="geo-status geo-status-ok"):(n.textContent="📍 Recherche de la position GPS...",n.className="geo-status geo-status-pending")};r.subscribe("geo.tracking",t),r.subscribe("geo.error",t),r.subscribe("geo.position",t),t(),r.subscribe("navigation.active",n=>{const i=document.getElementById("routeBanner");i&&(i.style.display=n?"flex":"none")}),r.subscribe("navigation.instruction",n=>{const i=document.getElementById("navInstruction");i&&(i.textContent=n||"—")}),r.subscribe("navigation.arrived",n=>{const i=document.getElementById("arrivalBanner");i&&(i.style.display=n?"block":"none")}),r.subscribe("tour.active",n=>{const i=document.getElementById("tourPanel");i&&(i.style.display=n?"block":"none"),n&&_e()}),r.subscribe("tour.currentIndex",()=>{_e()})}function _e(){const e=r.get("tour.points")||[],t=r.get("tour.currentIndex")||0,n=document.getElementById("tourProgress"),i=document.getElementById("tourSummary"),o=document.getElementById("tourList");if(n&&(n.textContent=e.length?`${t+1} / ${e.length} arrêts`:"0 arrêt"),i&&e.length){const s=e.reduce((a,c)=>a+(c.distanceFromPrev||0),0);i.textContent=`📍 ${e.length} points non-visités — ~${s<1?Math.round(s*1e3)+" m":s.toFixed(1)+" km"} au total`}o&&e.length&&(o.innerHTML=e.map((s,a)=>`
      <div class="tour-item ${a===t?"active":""}" style="padding: 8px 10px; margin-bottom: 6px; border-radius: 8px; background: ${a===t?"#e8f5e9":"#f9f9f9"}; border: 1px solid ${a===t?"#2ecc71":"#eee"}; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <b>${a+1}. ${s.name||"Point "+s.id}</b> <span style="font-size: 11px; color: #666;">(Bloc ${s.block})</span>
          <div style="font-size: 11px; color: #888;">${s.quartier||""} — ${s.produits||""}</div>
        </div>
        <button data-tour-index="${a}" class="tour-jump-btn" style="padding: 4px 8px; border: none; border-radius: 6px; background: #1a3d2b; color: white; font-size: 11px; cursor: pointer;">Voir</button>
      </div>
    `).join(""),o.querySelectorAll(".tour-jump-btn").forEach(s=>{s.addEventListener("click",async a=>{const c=parseInt(a.currentTarget.dataset.tourIndex,10),{goToPoint:m}=await K();r.set("tour.currentIndex",c),m(c)})}))}function le(){const e={block:document.getElementById("filterBlock").value,status:document.getElementById("filterStatus").value,visited:document.getElementById("filterVisited").value,search:document.getElementById("searchBox").value.trim()};r.set("filters",e);const n=r.get("points").filter(i=>Ft(i,e));j(n)}function Ft(e,t){if(t.block!=="all"&&String(e.block)!==t.block||t.status!=="all"&&e.status!==t.status||t.visited==="yes"&&!e.visited||t.visited==="no"&&e.visited)return!1;if(t.search){const n=t.search.toLowerCase();if(!`${e.name||""} ${e.quartier||""} ${e.address||""} ${e.tel||""} ${e.produits||""} ${e.id||""} ${e.order||""}`.toLowerCase().includes(n))return!1}return!0}function Vt(e){const t=document.getElementById("filterBlock");if(!t)return;[...new Set(e.map(i=>i.block))].sort((i,o)=>i-o).forEach(i=>{const o=document.createElement("option");o.value=String(i),o.textContent=`Bloc ${String(i).padStart(2,"0")}`,t.appendChild(o)})}function fe(){const e=r.get("points"),t=e.filter(s=>s.visited===!0).length,n=e.length,i=n>0?Math.round(t/n*100):0,o=document.getElementById("statsHeader");o&&(o.innerHTML=`
      <span>${t} / ${n} visités (${i}%)</span>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${i}%"></div>
      </div>
    `)}function ee(){const e=document.getElementById("quartierCoverageList");if(!e)return;const t=r.get("points")||[],n=r.get("targetZones")||[],i=new Map;n.forEach(s=>{i.set(s.name,{total:0,visited:0,targetZoneId:s.id})}),t.forEach(s=>{const a=(s.quartier||"").trim()||"Non renseigné";i.has(a)||i.set(a,{total:0,visited:0});const c=i.get(a);c.total++,s.visited&&c.visited++});const o=[...i.entries()].map(([s,a])=>({q:s,...a,pct:a.total?Math.round(a.visited/a.total*100):0})).sort((s,a)=>s.pct-a.pct||a.total-s.total);if(o.length===0){e.innerHTML=`<div style="font-size:12px; color:#94a3b8;">Aucune zone définie pour l'instant — ajoutez-en une ci-dessous.</div>`;return}e.innerHTML=o.map(s=>{const a=s.total===0?"#94a3b8":s.pct<40?"#e74c3c":s.pct<75?"#f1c40f":"#2ecc71",c=s.targetZoneId?`<button type="button" class="remove-zone-btn" data-zone-id="${s.targetZoneId}" title="Retirer cette zone cible" style="border:none; background:none; color:#94a3b8; cursor:pointer; font-size:13px; padding:0 2px;">✕</button>`:"";return`
      <div style="display:flex; align-items:center; gap:6px; font-size:12px;">
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${y(s.q)}">${s.total===0?"🎯 ":""}${y(s.q)}</span>
        <span style="color:#64748b; min-width:44px; text-align:right;">${s.visited}/${s.total}</span>
        <div style="width:44px; height:6px; border-radius:3px; background:#e2e8f0; overflow:hidden; flex-shrink:0;">
          <div style="height:100%; width:${s.pct}%; background:${a};"></div>
        </div>
        ${c}
      </div>
    `}).join(""),e.querySelectorAll(".remove-zone-btn").forEach(s=>{s.addEventListener("click",async()=>{const a=s.dataset.zoneId;try{await Lt(a),r.set("targetZones",(r.get("targetZones")||[]).filter(c=>c.id!==a)),ee()}catch(c){Le(c.message||"Impossible de retirer cette zone.")}})})}function zt(){const e=r.get("points"),t=["id","block","name","etablissement","activityType","tel","quartier","address","produits","sexe","status","visite","lat","lon"],n=e.map(c=>[c.id,c.block,c.name,c.etablissement,c.activityType,c.tel,c.quartier,c.address,c.produits,c.sexe,c.status,c.visited?"oui":"non",c.lat,c.lon]),i=[t,...n].map(c=>c.map(m=>`"${String(m??"").replace(/"/g,'""')}"`).join(",")).join(`
`),o=new Blob([i],{type:"text/csv;charset=utf-8;"}),s=URL.createObjectURL(o),a=document.createElement("a");a.href=s,a.download=`recensement_export_${new Date().toISOString().slice(0,10)}.csv`,a.click(),URL.revokeObjectURL(s),A()}const Ht=Object.freeze(Object.defineProperty({__proto__:null,mountAuthenticatedApp:Mt},Symbol.toStringTag,{value:"Module"}));export{Ht as a,Dt as m};
