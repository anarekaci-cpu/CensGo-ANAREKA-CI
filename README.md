# 📍 Recensement ANAREKA-CI

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-Ready-blueviolet)](https://web.dev/progressive-web-apps/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)

> Application PWA de recensement terrain pour les agents ANAREKA (Autorité Nationale de Régulation du secteur de l'Électricité — Côte d'Ivoire).
> Déployée à **Bingerville**, cette application permet aux agents de terrain de localiser, visiter et enregistrer l'état des points de recensement en temps réel, même hors connexion.

---

## ✨ Fonctionnalités

| Fonctionnalité | Description |
|----------------|-------------|
| 🗺️ **Carte interactive** | Visualisation Leaflet avec clusters de marqueurs colorés par statut |
| 📍 **Géolocalisation GPS** | Position temps réel + boussole intégrée |
| 🧭 **Navigation intégrée** | Itinéraire piéton vers le point sélectionné (OSRM) |
| 🔄 **Mode offline** | Synchronisation automatique dès la connexion retrouvée |
| 🎯 **Tournée optimisée** | Génération d'itinéraire optimal pour visiter les points non-recensés |
| 🔍 **Filtres avancés** | Par bloc, statut (Vert/Jaune/Rouge/Violet), état de visite |
| 📊 **Export CSV** | Export des données pour analyse et reporting |
| 🔐 **Authentification** | Connexion sécurisée via Supabase Auth |

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

# 2. Installer les dépendances (à venir avec Vite)
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos clés Supabase

# 4. Lancer en développement
npm run dev

# 5. Build pour production
npm run build
```

### Déploiement GitHub Pages
```bash
npm run deploy
```

---

## 🔐 Sécurité

> ⚠️ **IMPORTANT** : Avant toute mise en production, assurez-vous d'avoir :
> 1. Activé **Row Level Security (RLS)** sur toutes les tables
> 2. Régénéré vos clés API Supabase
> 3. Configuré les policies d'accès par utilisateur authentifié

Voir [docs/SECURITY.md](./docs/SECURITY.md) pour la configuration complète.

---

## 📁 Structure du projet

```
Recensement-ANAREKA-CI/
├── css/              # Styles Leaflet + custom
├── js/               # Modules JavaScript
│   ├── app.js        # Point d'entrée
│   ├── auth.js       # Authentification Supabase
│   ├── config.js     # Configuration (⚠️ à sécuriser)
│   ├── data.js       # Chargement des données
│   ├── markers.js    # Gestion des marqueurs & filtres
│   ├── map.js        # Initialisation carte
│   ├── geolocation.js# GPS & boussole
│   ├── navigation.js # Itinéraire & guidage
│   ├── routing.js    # Calcul d'itinéraire OSRM
│   ├── storage.js    # Stockage offline
│   └── tour.js       # Optimisation de tournée
├── index.html        # Application PWA
├── manifest.json     # Manifest PWA
└── ...
```

---

## 🛡️ Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Cartographie | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) |
| Backend & Auth | [Supabase](https://supabase.com/) |
| Routing | [OSRM](http://project-osrm.org/) |
| PWA | Service Worker, Manifest, localStorage → IndexedDB (migration) |

---

## 🤝 Contribution

Les contributions sont les bienvenues !

1. Fork le projet
2. Créez votre branche (`git checkout -b feature/AmazingFeature`)
3. Committez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

---

## 📄 Licence

Distribué sous licence MIT. Voir [LICENSE](./LICENSE) pour plus d'informations.

---

## 📬 Contact

**ANAREKA-CI** — [Site officiel](https://www.anareka.ci)  
Projet maintenu par l'équipe technique ANAREKA.

---

<p align="center">
  <sub>🇨🇮 Fierement développé en Côte d'Ivoire</sub>
</p>
