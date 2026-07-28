# 🚀 Guide de Migration — ANAREKA-CI v1 → v2

Ce guide vous accompagne pour migrer votre application legacy vers la nouvelle architecture **Vite + IndexedDB + Modules ES6**.

---

## 📋 Prérequis

- Node.js ≥ 18 ([télécharger](https://nodejs.org))
- Git
- Un terminal (PowerShell, Terminal, ou CMD)

---

## 🔧 Étape 1 : Installer le nouveau projet

```bash
# 1. Se placer dans le dossier du repo existant
cd Recensement-ANAREKA-CI

# 2. Créer une branche de migration
git checkout -b migration-vite

# 3. Sauvegarder l'ancien code (optionnel mais recommandé)
mkdir _legacy
cp -r css js index.html manifest.json _legacy/

# 4. Copier les nouveaux fichiers
cp -r /chemin/vers/anareka-vite-migration/* .

# 5. Installer les dépendances
npm install
```

---

## 🔐 Étape 2 : Configurer les variables d'environnement

```bash
# Copier le template
cp .env.example .env

# Éditer .env avec vos vraies clés (NE JAMAIS COMMITTER CE FICHIER)
nano .env  # ou VS Code : code .env
```

Contenu du `.env` :
```
VITE_SUPABASE_URL=https://xqfdhgrdvsdngfgiuomk.supabase.co
VITE_SUPABASE_ANON_KEY=votre-nouvelle-cle-regeneree
VITE_MAP_CENTER_LAT=5.355
VITE_MAP_CENTER_LNG=-3.88
VITE_MAP_ZOOM=13
VITE_OSRM_URL=https://router.project-osrm.org
```

---

## 🗄️ Étape 3 : Migrer les données IndexedDB (premier lancement)

La nouvelle version utilise **Dexie.js** avec un schéma structuré. 
Au premier lancement, l'application :
1. Tente de charger depuis Supabase
2. Si offline, charge depuis IndexedDB (nouveau format)
3. Si vide, affiche un message d'erreur

**Pour pré-remplir IndexedDB** (si vous avez des données locales dans l'ancien localStorage) :

Ouvrir la console DevTools (F12) → Application → IndexedDB → ANAREKA_CensusDB

---

## ▶️ Étape 4 : Lancer en développement

```bash
npm run dev
```

Ouvrir http://localhost:5173/Recensement-ANAREKA-CI/

---

## 🏗️ Étape 5 : Build pour production

```bash
npm run build
```

Le dossier `dist/` contient l'application prête pour GitHub Pages.

---

## 📤 Étape 6 : Déployer sur GitHub Pages

```bash
# Installer gh-pages (déjà dans devDependencies)
npm install -g gh-pages

# Déployer
npm run deploy
```

---

## 📁 Différences clés v1 → v2

| Aspect | v1 (Legacy) | v2 (Vite) |
|--------|-------------|-----------|
| **Build** | Aucun (fichiers statiques) | Vite (bundling, HMR, optimisation) |
| **Modules** | Global `window` | ES6 modules (`import`/`export`) |
| **Stockage** | localStorage | IndexedDB (Dexie.js) |
| **Sync** | Manuel | Automatique (30s + event online/offline) |
| **PWA** | Manifest basique | vite-plugin-pwa (SW, cache, offline) |
| **State** | Variables globales | Store centralisé (Observer pattern) |
| **Config** | JS en dur | Variables d'environnement `.env` |
| **Carte tuiles** | Toujours online | Cache offline (Workbox) |
| **Tests** | Aucun | Prêt pour Vitest |

---

## 🧪 Vérifier que tout fonctionne

### Checklist de validation

- [ ] `npm run dev` démarre sans erreur
- [ ] La carte s'affiche avec les points
- [ ] La connexion Supabase fonctionne
- [ ] Les filtres fonctionnent
- [ ] La géolocalisation fonctionne
- [ ] Le mode offline fonctionne (coupez le WiFi)
- [ ] La sync reprend quand vous reconnectez
- [ ] L'export CSV fonctionne
- [ ] La tournée optimisée fonctionne

---

## 🐛 Dépannage

### "Supabase non configuré"
→ Vérifiez que `.env` existe et contient les bonnes clés.

### "IndexedDB bloquée"
→ Chrome : DevTools → Application → Storage → Clear site data

### "Les marqueurs ne s'affichent pas"
→ Vérifiez la console pour les erreurs CORS. Le proxy OSRM public peut être limité.

### "Build échoue"
→ Assurez-vous que Node.js ≥ 18 : `node -v`

---

## 🎯 Prochaines étapes

Après la migration réussie :
1. Ajouter les tests (Vitest)
2. Intégrer la reconnaissance vocale
3. Développer le modèle de prédiction ML
4. Créer le dashboard superviseur

---

## 📞 Support

Ouvrez une issue sur GitHub ou contactez l'équipe technique ANAREKA.
