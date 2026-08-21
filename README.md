# 📍 Recensement ANAREKA-CI

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-Ready-blueviolet)](https://web.dev/progressive-web-apps/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)

> Application PWA de recensement terrain pour les agents de l'**ANAREKA-CI** (Association Nationale des Restaurateurs et Kiosques d'Attiéké de Côte d'Ivoire).
> Localiser, référencer et suivre les restaurateurs, kiosques d'attiéké, vendeurs ambulants et producteurs en Côte d'Ivoire, **même hors connexion**.

---

## ✨ Fonctionnalités

| Fonctionnalité | Description |
|----------------|-------------|
| 🗺️ **Carte interactive** | MapLibre GL + clustering Supercluster — fluide jusqu'à 10 000+ points |
| ⚡ **Chargement progressif** | Cache IndexedDB affiché instantanément, synchronisation Supabase en arrière-plan |
| 📍 **Géolocalisation GPS** | Position temps réel + marqueur « vous êtes ici » + suivi des agents (admin) |
| 🧭 **Navigation intégrée** | Itinéraire piéton OSRM + détection d'arrivée (rayon configurable) |
| 🔄 **Mode offline complet** | Création/modification hors-ligne, file d'attente de sync avec retry et dead-letters |
| 🎯 **Tournée optimisée** | Plus proche voisin plafonné à 150 arrêts — jamais de blocage du thread principal |
| 🔍 **Filtres locaux** | Bloc, statut, visités, recherche — filtrage 100 % local, sans requête réseau |
| 📊 **Analyse intégrée** | Statistiques calculées en un seul passage O(N) : couverture, quartiers, statuts, activités |
| 📄 **Export CSV** | Export des données pour analyse et reporting |
| 🔐 **Authentification** | Supabase Auth + rôles (agent / admin) via table `user_roles` |

---

## 🚀 Démarrage rapide

### Prérequis
- Node.js ≥ 18
- Un compte [Supabase](https://supabase.com)
- Git

### Installation

```bash
# 1. Cloner le repository
git clone https://github.com/anarekaci-cpu/Recensement-ANAREKA-CI.git
cd Recensement-ANAREKA-CI

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos clés Supabase (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

# 4. Lancer en développement (http://localhost:3000)
npm run dev

# 5. Build production -> dist/
npm run build
```

### Commandes disponibles

| Commande | Rôle |
|----------|------|
| `npm run dev` | Serveur Vite (port 3000) |
| `npm run build` | Build production dans `dist/` |
| `npm run preview` | Prévisualiser le build |
| `npm test` / `npm run test:watch` | Tests Vitest |
| `npm run lint` / `npm run lint:fix` | ESLint sur `src/` |
| `npm run deploy` | Build + déploiement GitHub Pages |

---

## 🏗️ Architecture

```text
src/
├── main.js                  # Bootstrap : IndexedDB → Auth → Sync → App → GPS
├── appShell.js              # Écran login / garde de montage unique de l'app
├── appView.js               # Vue authentifiée : layout, filtres, stats, events
├── style.css                # Styles uniques
├── core/
│   ├── store.js             # Store centralisé (Observer, chemins pointés)
│   ├── config.js            # CONFIG (variables VITE_*)
│   ├── supabase.js          # Client Supabase singleton
│   ├── normalize.js         # normalizePoint() — format unique de données
│   ├── analytics.js         # computeStats() — statistiques en 1 passage O(N)
│   ├── filters.js           # passesFilters()/filterPoints() — logique pure
│   ├── tourPlanner.js       # Tournée plus-proche-voisin plafonnée (pure)
│   ├── targetZones.js       # Zones cibles admin (Supabase)
│   ├── geo.js / utils.js / toast.js / confirmModal.js
├── db/
│   └── database.js          # Dexie/IndexedDB : points, file syncQueue, meta
└── modules/
    ├── auth/                # Session Supabase (comparaison par id utilisateur)
    ├── census/              # dataLoader (cache-first paginé), markers (pool), form
    ├── map/                 # MapLibre + Supercluster + couches itinéraire
    ├── geolocation/         # GPS temps réel + suivi agents
    ├── navigation/          # Guidage + détection d'arrivée
    ├── routing/             # OSRM
    ├── sync/                # Moteur de sync offline→Supabase
    ├── tour/                # Tournée optimisée
    └── ai/                  # Agents IA (Edge Function Gemini, fallback local)
```

### Flux de chargement (cache-first)

```text
Ouverture → IndexedDB → AFFICHAGE IMMÉDIAT (< 1 s si cache présent)
                 ↓ (en parallèle)
          Supabase (paginé, timeout 12 s/page)
                 ↓
          Normalisation → fusion visited local → IndexedDB → Store → UI
```

### Synchronisation offline

1. Chaque création/modification est écrite dans IndexedDB **et** dans la file `syncQueue`.
2. Le moteur de sync (toutes les 30 s, au retour du réseau, ou manuel) envoie la file vers Supabase.
3. Une opération n'est retirée de la file **que si le serveur l'a acceptée**.
4. Après 3 échecs : l'entrée passe en « dead », visible dans le header avec retry manuel.
5. Les `update_visit` répétées sur un même point sont dédupliquées (la dernière gagne).

---

## 🔐 Sécurité

> ⚠️ Avant toute mise en production :
> 1. Activer **Row Level Security (RLS)** — script prêt : `supabase/reset_rls.sql`
> 2. **Régénérer les clés API Supabase** (une clé anon a été exposée dans l'historique Git par le passé)
> 3. Ne JAMAIS committer le fichier `.env` (hook pre-commit en place)

Voir [SECURITY.md](./SECURITY.md) pour le modèle d'accès complet.

---

## 🛡️ Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Vanilla JS (ES modules), Vite |
| Cartographie | [MapLibre GL JS](https://maplibre.org/) + [Supercluster](https://github.com/mapbox/supercluster) + tuiles CARTO Voyager |
| Backend & Auth | [Supabase](https://supabase.com/) (Postgres + RLS + Edge Functions) |
| Stockage offline | [Dexie.js](https://dexie.org/) (IndexedDB) |
| Routing | [OSRM](http://project-osrm.org/) |
| PWA | vite-plugin-pwa (Workbox, autoUpdate) |
| Tests | [Vitest](https://vitest.dev/) + jsdom |

---

## 🤝 Contribution

Les contributions sont les bienvenues !

1. Fork le projet
2. Créez votre branche (`git checkout -b feature/AmazingFeature`)
3. Committez (`feat:`, `fix:`, `docs:`, `perf:`… — voir CONTRIBUTING.md)
4. Push puis ouvrez une Pull Request

---

## 📄 Licence

Distribué sous licence MIT. Voir [LICENSE](./LICENSE).

---

## 📬 Contact

**ANAREKA-CI** — [Site officiel](https://anarekaci.com) — info@anarekaci.com
Cocody Riviera Bonoumin, Cité Syninfo, Abidjan, Côte d'Ivoire

---

<p align="center">
  <sub>🇨🇮 Fièrement développé en Côte d'Ivoire</sub>
</p>
