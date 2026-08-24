# 🚀 Roadmap de modernisation — CensGo-ANAREKA-CI

> Document de référence pour Claude Code. Chaque section peut être donnée
> comme tâche séparée (`Implémente la section X du fichier
> ROADMAP_MODERNISATION.md`).

Contexte technique actuel à connaître avant de commencer :
- Le serveur OSRM configuré (`CONFIG.OSRM_URL`) n'expose **qu'un seul
  profil : "foot"**. Même en demandant `/route/v1/bike/` ou
  `/route/v1/car/`, on obtient l'itinéraire piéton mal étiqueté. Voir les
  commentaires dans `src/modules/routing/routing.js`.
- La durée de trajet n'est jamais prise depuis la réponse OSRM (le profil
  "foot" du serveur renvoie des durées incohérentes, ~46 km/h). Elle est
  systématiquement dérivée de la distance routée réelle × une vitesse
  moyenne par mode (`AVERAGE_SPEEDS_MPS`).
- Aucune donnée de trafic temps réel n'est disponible gratuitement de
  façon fiable en Côte d'Ivoire (couverture TomTom/Google limitée).

---

## Priorité 0 — Bugs / dette technique existants (audit du 2026-08-24)

1. **Rotation de la clé Supabase `anon`** exposée dans l'historique Git
   entre les commits `f67073f` et `09d5296`. Régénérer la clé depuis le
   dashboard Supabase (priorité absolue, documentée dans `SECURITY.md`
   depuis plusieurs audits).
2. **Vérifier le redéploiement de la fonction Edge `ai-agent`**
   (`supabase/functions/ai-agent/index.ts`). Le code valide désormais
   `auth.getUser()` + l'approbation du compte, mais ce correctif ne
   prend effet qu'après `supabase functions deploy ai-agent` — à
   confirmer en prod.
3. **Réduire le bundle `maplibre-gl`** (811 Ko / 221 Ko gzip, dépasse
   le seuil d'avertissement Vite). Passer par un `import()` dynamique
   chargé seulement à l'affichage de la carte, ou `manualChunks`.

---

## Priorité 1 — Itinéraires réels par mode (voiture / vélo / piéton)

**Problème** : un seul profil OSRM ("foot") est utilisé pour tous les
modes de navigation, donc les "raccourcis" voiture/vélo n'existent pas
réellement aujourd'hui.

Options, de la plus rapide à la plus complète :

- **Option A — OSRM multi-profils auto-hébergé.** Déployer une instance
  OSRM avec les profils `car.lua`, `bicycle.lua`, `foot.lua` sur un
  extrait OSM de la Côte d'Ivoire (Docker). Le plus proche du système
  actuel, mais demande de l'infra à maintenir.
- **Option B — OpenRouteService (recommandé).** Gratuit, clé API,
  quota généreux (2000 req/jour en libre-service). Gère nativement les
  profils piéton/vélo/voiture avec de vrais temps de trajet et
  l'évitement de zones. Migration : remplacer les appels
  `CONFIG.OSRM_URL` par le endpoint ORS `/v2/directions/{profile}`,
  adapter le parsing de la réponse GeoJSON dans
  `src/modules/routing/routing.js`.
- **Option C — Mapbox Directions API.** Payant mais inclut le trafic
  live et des profils précis. À envisager seulement si le budget de
  l'association le permet.

**Tâche pour Claude Code** : implémenter l'option B en priorité,
garder l'option A en fallback offline (OSRM local reste utile hors
connexion).

---

## Priorité 2 — Trafic / embouteillages

Pas de solution gratuite fiable pour du trafic temps réel en Côte
d'Ivoire. Approche réaliste en deux temps :

1. **Trafic heuristique (immédiat, gratuit)** : ajuster la vitesse
   moyenne du mode voiture selon l'heure de la journée — heures de
   pointe Abidjan/Bingerville (7h-9h, 17h-19h) avec un facteur de
   ralentissement configurable. Ce n'est pas du vrai trafic mais une
   estimation utile pour la planification de tournée.
2. **TomTom Traffic API (optionnel, à tester)** : tier gratuit
   jusqu'à 2500 requêtes/jour. Couverture à valider sur Abidjan avant
   de s'engager — certaines zones africaines sont mal couvertes par
   les fournisseurs de trafic commerciaux.

**Tâche pour Claude Code** : implémenter l'heuristique horaire dans
`AVERAGE_SPEEDS_MPS` (mode voiture uniquement), avec un module séparé
et testable (`trafficHeuristic.js`) plutôt que de modifier la logique
existante en dur.

---

## Priorité 3 — Météo

**Open-Meteo** (100 % gratuit, sans clé API — adapté à un projet
associatif) :

- Météo actuelle à la position de l'agent (widget dans l'appShell)
- Alerte pluie avant de démarrer une tournée (pistes non bitumées à
  Bingerville — impact réel sur le terrain)
- Prévision J+1 pour aider à planifier les tournées du lendemain

**Tâche pour Claude Code** : nouveau module `src/modules/weather/`,
appel à `https://api.open-meteo.com/v1/forecast`, cache IndexedDB
(comme pour les tuiles offline) pour ne pas dépendre du réseau à
chaque affichage.

---

## Priorité 4 — Fonctionnalités "tout-en-un"

- **Tableau de bord admin enrichi** : heatmap de couverture par
  quartier, tendance de progression dans le temps (déjà une base avec
  `computeStats()` dans `src/core/analytics.js`)
- **Export PDF de rapport de tournée** (en complément du CSV existant)
- **Notifications** : rappel de tournée du jour, alerte météo, badge
  "nouveau point ajouté par un collègue"
- **Mode sombre** (déjà signalé manquant lors de l'audit frontend)
- **Messagerie interne agent ↔ admin** via Supabase Realtime
- **Gamification légère** : badges/progression par agent pour motiver
  la couverture terrain
- **Reconnaissance photo enrichie** : étendre le module IA existant
  (`src/modules/ai/`) pour auto-remplir des champs du formulaire
  depuis une photo (enseigne, type de kiosque)

---

## Ordre d'implémentation suggéré

1. Priorité 0 (sécurité — ne pas repousser)
2. Priorité 3 (météo — rapide, gratuit, forte valeur terrain)
3. Priorité 1 (itinéraires réels — cœur de la demande "raccourcis")
4. Priorité 2 (trafic heuristique)
5. Priorité 4 (features, une par une, en fonction du retour des agents)
