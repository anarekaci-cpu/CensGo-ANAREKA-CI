import{g as b,s as y}from"./index-CtKviW6E.js";import"./supabase-DthfXWp1.js";import"./dexie-042nW8Tv.js";import"./maplibregl-CKm7LQp5.js";async function w(r,{prompt:i,points:u,userPos:t,imageBase64:s,mimeType:c}={}){try{const l=b(),{data:o,error:g}=await l.functions.invoke("ai-agent",{body:{action:r,prompt:i,points:u,userPos:t,imageBase64:s,mimeType:c}});if(g)throw new Error(g.message||"Edge function error");return o&&o.success&&o.result?{success:!0,text:o.result}:(o&&o.fallback&&console.info("Clé Gemini non configurée — mode analyse locale activé"),$(r,{prompt:i,points:u,userPos:t,imageBase64:s}))}catch(l){return console.warn("API IA indisponible, réponse locale :",l.message),$(r,{prompt:i,points:u})}}function j(r,i,u){const t=window.SpeechRecognition||window.webkitSpeechRecognition;if(!t)return null;const s=new t;return s.lang="fr-FR",s.continuous=!1,s.interimResults=!1,s.onresult=c=>{const l=c.results[0][0].transcript;r&&r(l)},s.onerror=c=>{i&&i(c)},s.onend=()=>{u&&u()},s}function $(r,{prompt:i,points:u}){var v,m,A;const t=u||y.get("points")||[],s=t.filter(e=>!e.visited),c=t.filter(e=>{var n;return(n=e.status)==null?void 0:n.includes("JAUNE")}),l=t.filter(e=>{var n;return(n=e.status)==null?void 0:n.includes("VIOLET")}),o=new Map;t.forEach(e=>{e.quartier&&o.set(e.quartier,(o.get(e.quartier)||0)+1)});const g=(v=[...o.entries()].sort((e,n)=>n[1]-e[1])[0])==null?void 0:v[0],p=(m=[...o.entries()].sort((e,n)=>e[1]-n[1])[0])==null?void 0:m[0];if(r==="optimize_tour")return{success:!0,text:`🤖 **Agent Strategist ANAREKA-CI** :

📍 **Statut du secteur** : ${s.length} établissements restants sur ${t.length}.

1. **Recommandation Horaires** : Commencez par *${((A=s[0])==null?void 0:A.quartier)||g||"votre zone actuelle"}* (concentration élevée de restaurateurs/kiosques à recenser).
2. **Points d'Urgence** : Priorisez les ${c.length} établissement(s) injoignable(s) en fin de matinée (entre 11h30 et 13h, hors coup de feu du service).
3. **Efficacité de tournée** : Regroupez vos passages par quartier pour minimiser vos déplacements entre kiosques.`};if(r==="audit_quality"){const e=t.filter(a=>!a.tel||a.tel===""),n=t.filter(a=>!a.address||a.address===""),d=t.filter(a=>!a.activityType);return{success:!0,text:`🔍 **Agent Inspecteur Qualité Données** :

📊 **Rapport d'audit de la base** (${t.length} fiches) :

• ⚠️ **Numéros manquants** : ${e.length} fiche(s) sans contact renseigné.
• 📍 **Emplacements imprécis** : ${n.length} fiche(s) nécessitent un repère plus précis.
• 🏪 **Type d'activité manquant** : ${d.length} fiche(s) sans Kiosque/Restaurant/Vendeur/Producteur renseigné.
• ❓ **Statuts "À vérifier" (Violet)** : ${l.length} fiche(s) doivent faire l'objet d'un second passage.

💡 *Conseil : Complétez les données dès que vous êtes sur place avant de valider la visite.*`}}if(r==="daily_briefing"){const e=t.length,n=e-s.length,d=Math.round(n/(e||1)*100);return{success:!0,text:`📋 **Briefing IA Matinal — ANAREKA-CI** :

🌤️ **Terrain** : Zone d'intervention prioritaire aujourd'hui : ${p?`*${p}* (couverture la plus faible)`:"à définir selon votre secteur"}.
🎯 **Objectif du jour** : Atteindre **${Math.min(e,n+8)} fiches validées** (+${Math.min(8,s.length)} aujourd'hui).
📊 **Progression Actuelle** : **${d}%** (${n}/${e} restaurateurs/kiosques recensés).

⚡ **Action recommandée** : Activez la tournée optimisée pour enchaîner les établissements les plus proches sans détours.`}}if(r==="parse_voice_note"){const e=(i||"").match(/(?:0[175])\d{8}/)||(i||"").match(/\d{10}/),n=e?e[0]:"",d=!(i||"").toLowerCase().includes("non")&&!(i||"").toLowerCase().includes("absent"),a=(i||"").toLowerCase().includes("injoignable")?"Jaune — Injoignable":d?"Vert — Validé":"Rouge — Refus / Inaccessible";return{success:!0,text:`🎙️ **Agent Transcripteur IA** :

Analyse de la note vocale terrain : *"${i||"Rien à signaler"}"*

• **Statut détecté** : ${a}
• **Contact extrait** : ${n||"Non spécifié"}
• **Action** : Fiche prête à être mise à jour avec statut visité = ${d?"Oui":"Non"}.`}}if(r==="vision_ocr")return{success:!0,text:`📸 **Agent Vision** :

⚠️ *Analyse photo indisponible* — la clé API Gemini n'est pas configurée sur ce serveur.

Pour activer l'analyse photo, ajoutez \`GEMINI_API_KEY\` dans le fichier \`.env\` du serveur.

En attendant, relevez manuellement le nom de l'enseigne et le type d'activité depuis la photo.`};const f=(i||"").toLowerCase();let h="";if(f.includes("priorité")||f.includes("priorite")||f.includes("quoi faire"))h=`🎯 **Priorités du jour** :

Vous avez **${s.length} établissement(s)** à recenser aujourd'hui.${g?` Concentrez-vous d'abord sur *${g}*.`:""}`;else if(f.includes("synthèse")||f.includes("synthese")||f.includes("rapport")){const e=t.filter(d=>d.visited).length;h=`📊 **Synthèse du Recensement ANAREKA-CI** :

Progression globale : **${Math.round(e/(t.length||1)*100)}%** (${e}/${t.length} restaurateurs/kiosques recensés).
Statuts à relancer : ${c.length} injoignables, ${l.length} à vérifier.`}else h=`🤖 **Agent Copilot Terrain** :

J'ai analysé votre requête (*"${i}"*).
Il vous reste ${s.length} établissement(s) à recenser. N'hésitez pas à utiliser la dictée vocale ou la tournée optimisée !`;return{success:!0,text:h}}export{w as askAiAgent,j as createSpeechRecognizer};
