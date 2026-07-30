# Correctifs Recensement-ANAREKA-CI

Deux façons d'appliquer ces correctifs à ton dépôt local :

## Option 1 — Appliquer le patch (le plus simple)
Depuis la racine de ton dépôt cloné :
```bash
git apply correctifs.patch
```
Le patch fait aussi les 2 suppressions nécessaires : `.env` (retiré du suivi
Git — garde une copie locale hors Git si tu veux la conserver) et
`manifest.json` (obsolète, doublon du manifest généré par vite-plugin-pwa).

## Option 2 — Remplacer les fichiers à la main
Copie chaque fichier de ce dossier au même chemin dans ton dépôt :
- `vite.config.js`
- `index.html`
- `.eslintrc.json` (nouveau fichier)
- `src/app.js`
- `src/main.js`
- `src/modules/census/censusFormModal.js`
- `src/modules/census/markers.js`
- `src/modules/sync/syncEngine.js`

Puis supprime manuellement :
- `manifest.json` (racine du projet)
- Retire `.env` du suivi Git avec `git rm --cached .env` (le fichier reste
  sur ton disque pour que le build continue de fonctionner)

## Résumé des correctifs
1. **vite.config.js** — `base` corrigé pour le sous-dossier GitHub Pages
   (`/Recensement-ANAREKA-CI/`) + icônes du manifest PWA préfixées de même.
   C'était la cause de l'écran blanc en production (tous les assets
   pointaient vers la racine du domaine → 404).
2. **src/modules/sync/syncEngine.js** — traite maintenant l'action
   `upsert_point` en plus de `update_visit`. Les ménages ajoutés/édités via
   le formulaire n'étaient jamais envoyés vers Supabase auparavant.
3. **src/modules/census/markers.js** + **censusFormModal.js** — nouvelle
   fonction `upsertMarker` : un nouveau point apparaît immédiatement sur la
   carte au lieu d'exiger un rechargement de page.
4. **src/app.js** — garde-fou si la position GPS n'est pas encore
   disponible au lancement d'une tournée optimisée (évite un plantage).
5. **src/main.js** — suppression d'un import mort (`initMap`).
6. **index.html** / suppression de `manifest.json` — retrait du manifest
   statique en doublon avec celui généré automatiquement par
   vite-plugin-pwa.
7. **.eslintrc.json** — config minimale ajoutée ; `npm run lint` échouait
   totalement faute de configuration.
8. **.env** retiré du suivi Git — il contenait tes vraies clés Supabase,
   committées malgré le `.gitignore`. Comme le dépôt est public, ces clés
   restent visibles dans l'historique Git tant que tu ne le réécris pas
   (ex. `git filter-repo`). Vérifie que les règles RLS sur ta table
   `census_points` sont bien actives, la clé étant de type "publishable/anon".

Après application, `npm install && npm run build` doit passer sans erreur,
et `npm run lint` doit tourner (13 avertissements mineurs restants sur des
variables non utilisées, rien de bloquant).
