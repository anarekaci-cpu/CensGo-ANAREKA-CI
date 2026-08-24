# Audit CensGo ANAREKA-CI

## Périmètre et méthode

Audit Phase 0 en lecture seule du dépôt : frontend Vanilla JS/Vite, IndexedDB/Dexie, synchronisation Supabase, RLS et fonctions SQL, Edge Function IA, PWA/Workbox, CI GitHub Actions, configuration, dépendances, tests et documentation.

Aucun fichier existant n'a été modifié pendant l'audit. Le seul fichier créé est ce rapport.

Vérifications locales effectuées :

- `npm test -- --run` : 25 fichiers, 204 tests passés.
- `npm run lint` : réussi.
- `npm audit --omit=dev` : aucune vulnérabilité de production signalée.
- `git status` : branche locale en avance de 5 commits sur `origin/main`; deux fichiers non suivis : `5-tour-started.png` et `tourreport-check.tmp.cjs`.
- `.env` local présent mais non suivi; son contenu n'est pas reproduit dans ce rapport.
- Les fichiers `.env` ont toutefois été commités dans l'historique Git par le passé.

## Architecture constatée

- Entrée : `src/main.js`, puis IndexedDB, auth, synchronisation, shell et vue authentifiée.
- Vue principale fortement concentrée dans `src/appView.js`.
- Etat partagé : `src/core/store.js`, Observer par chemins pointés.
- Persistance : `src/db/database.js`, Dexie avec points, file `syncQueue` et métadonnées.
- Chargement : `src/modules/census/dataLoader.js`, cache-first et pagination Supabase.
- Sync : `src/modules/sync/syncEngine.js`, retries, dead letters, déduplication et conflits.
- Carte : MapLibre GL, Supercluster et marqueurs DOM poolés/indexés.
- Routing : OpenRouteService côté navigateur si clé configurée, fallback OSRM.
- IA : Edge Function Supabase `supabase/functions/ai-agent/index.ts`.
- Backend SQL : `supabase/schema.sql`, `supabase/reset_rls.sql`, `supabase/fix_read_access.sql`.
- PWA : `vite-plugin-pwa` en mode `generateSW`, caches Workbox et GitHub Pages.

## CRITIQUE

### C1 - Risque de perte/disparition de données avec le delta sync

- Fichier : `src/modules/census/dataLoader.js`, `_loadCensusData()` et `fetchAllPages()`; `src/db/database.js`, `savePoints()`.
- Problème : une requête filtrée par `updated_at >= lastSync` ne retourne que les changements, mais `savePoints()` efface puis réécrit la table IndexedDB. Les points inchangés absents du delta peuvent donc disparaître de la carte, des statistiques et des tournées.
- Impact : intégrité locale rompue après une synchronisation incrémentale; risque de perte opérationnelle apparente, et risque de masquer des fiches hors ligne.
- Correction proposée : réserver `savePoints()` aux synchronisations complètes et ajouter une transaction `upsertPoints()` pour les deltas; ne jamais supprimer les points non retournés par un delta. Traiter aussi les suppressions via un mécanisme explicite (`deleted_at` ou tombstones).
- Risque de régression : élevé; tester full sync, delta vide, pagination partielle, mutations locales concurrentes, redémarrage et retour réseau.

### C2 - Le modèle RLS ne permet pas clairement le workflow collaboratif annoncé

- Fichiers : `supabase/schema.sql`, `supabase/reset_rls.sql`, `src/modules/sync/syncEngine.js`.
- Problème : UPDATE/INSERT sont limités au propriétaire `created_by = auth.uid()` ou à l'admin, alors que les agents voient toutes les fiches et peuvent tenter de les marquer visitées. Les fiches importées avec `created_by IS NULL` peuvent passer en dead letters.
- Impact : fonctionnalités visibles mais impossibles à synchroniser; accumulation d'échecs et confusion terrain.
- Correction proposée : décider explicitement entre modèle collaboratif (agents approuvés autorisés à modifier les champs prévus) et modèle propriétaire (masquer/refuser les actions hors périmètre). Ajouter des tests RLS sur fiches importées, fiches d'un agent et fiches admin.
- Risque de régression : élevé; toute ouverture de policy doit préserver la confidentialité et les limites admin.

### C3 - Clé OpenRouteService exposée dans le bundle navigateur

- Fichiers : `src/core/config.js`, `src/modules/routing/routing.js`, `vite.config.js`.
- Problème : `VITE_ORS_API_KEY` est envoyée directement depuis le navigateur.
- Impact : quota ORS épuisable par n'importe quel utilisateur capable d'inspecter le bundle ou le trafic; une clé frontend ne peut pas être considérée comme secrète.
- Correction proposée : proxy/Edge Function authentifiée côté Supabase, restrictions de quota et de domaine côté fournisseur; conserver le fallback OSRM local/offline.
- Risque de régression : moyen à élevé; latence, gestion des quotas et fallback doivent être testés.

### C4 - Anciennes clés et fichiers `.env` exposés dans l'historique

- Fichiers : historique Git, `.gitignore`, `SECURITY.md`.
- Problème : `git log` montre plusieurs commits ayant ajouté ou modifié `.env`; une ancienne clé Supabase est donc récupérable dans l'historique.
- Impact : compromission potentielle jusqu'à rotation effective; risque d'accès aux ressources selon les policies et la durée de validité des clés.
- Correction proposée : rotation immédiate des clés concernées, révocation des anciennes, audit des logs Supabase et purge historique seulement selon une procédure validée. Ne jamais ajouter `.env` au dépôt.
- Risque de régression : moyen; toutes les plateformes et secrets CI doivent être mis à jour simultanément.

## HAUTE

### H1 - Ecrasement possible lors d'un conflit `upsert_point`

- Fichier : `src/modules/sync/syncEngine.js`, `syncOne()`.
- Problème : si la lecture préalable de `updated_at` échoue, le code poursuit volontairement avec un `upsert`.
- Impact : une modification serveur concurrente peut être écrasée sans détection lorsque le contrôle de version est indisponible.
- Correction proposée : conserver l'opération en attente et retenter si `baseUpdatedAt` est défini mais invérifiable; ou utiliser une RPC atomique avec condition de version.
- Risque de régression : moyen; les pannes réseau ne doivent jamais perdre la donnée locale.

### H2 - `markPointSynced()` peut masquer d'autres mutations du même point

- Fichiers : `src/db/database.js`, `markPointSynced()` et `savePoints()`.
- Problème : le point peut être marqué synchronisé alors qu'une autre entrée pertinente existe encore dans `syncQueue`.
- Impact : un rechargement serveur peut considérer la fiche comme sûre et écraser une mutation locale encore en attente.
- Correction proposée : calculer `syncedAt` après vérification qu'il n'existe plus d'opération pending/dead pour ce point, ou lier l'état à une version/mutation précise.
- Risque de régression : élevé; tester plusieurs edits offline, update_visit après upsert et retries concurrents.

### H3 - Validation géofence serveur basée sur des coordonnées client falsifiables

- Fichiers : `supabase/reset_rls.sql`, fonction `assert_visit_geofence()`; `src/db/database.js`.
- Problème : le serveur contrôle la distance, mais utilise latitude/longitude, sans âge ni précision du fix, fournies par le client.
- Impact : un GPS simulé ou un appel API manuel peut contourner la preuve de présence; le GPS navigateur ne fournit pas une preuve anti-fraude forte.
- Correction proposée : enregistrer timestamp, accuracy et événement append-only; rejeter les fixes trop anciens ou manifestement invalides avec tolérance métier; signaler les séquences anormales à l'admin. Garder le RPC côté serveur comme barrière principale.
- Risque de régression : élevé; risque de faux positifs sur appareils bas de gamme.

### H4 - Edge Function IA insuffisamment protégée

- Fichier : `supabase/functions/ai-agent/index.ts`.
- Problèmes observés : CORS large (`*`), limites de taille non évidentes, validation insuffisante des actions/prompt/image, absence de rate limiting visible, données personnelles potentiellement envoyées à Gemini, erreurs potentiellement trop détaillées.
- Impact : abus de quota, coûts imprévus, prompt injection, fuite ou sur-collecte de données personnelles.
- Correction proposée : allowlist d'origines, validation stricte des payloads et tailles, quotas par utilisateur/action, minimisation des données, erreurs génériques côté client, logs sans données sensibles.
- Risque de régression : moyen; tester auth, quotas, images volumineuses, actions inconnues et réseau instable.

### H5 - CI ne bloque pas les régressions

- Fichier : `.github/workflows/deploy.yml`.
- Problèmes : `npm run lint || echo ...` masque un échec; `npm test` n'est pas exécuté; actions GitHub référencées par tags mutables (`@v4`).
- Impact : un build peut être déployé malgré des erreurs lint ou tests absents.
- Correction proposée : exécuter `npm ci`, lint strict, tests, build; supprimer le fallback `|| echo`; séparer validation PR et déploiement; épingler les actions par SHA après validation.
- Risque de régression : faible à moyen; le pipeline commencera à révéler des défauts jusque-là masqués.

### H6 - Données personnelles en clair dans IndexedDB et localStorage

- Fichiers : `src/db/database.js`, `src/modules/census/censusFormModal.js`.
- Problème : noms, téléphones, adresses, GPS et brouillons sont stockés localement sans chiffrement ni expiration documentée.
- Impact : exposition sur appareil partagé, perdu, compromis ou inspecté localement.
- Correction proposée : définir une politique de minimisation et de rétention; expiration des brouillons; étudier un chiffrement lié à la session/appareil seulement après tests de restauration, recherche et offline.
- Risque de régression : élevé pour un chiffrement; moyen pour expiration/minimisation.

### H7 - Absence visible de nettoyage du `watchPosition()`

- Fichier : `src/modules/geolocation/geolocation.js`.
- Problème : `watchPosition()` est lancé mais aucun `clearWatch()` n'est exposé pour déconnexion/démontage.
- Impact : consommation batterie, callbacks persistants et références conservées pendant les changements de session ou remounts.
- Correction proposée : confirmer le cycle de vie réel, puis exposer une fonction de teardown idempotente si le watch survit effectivement à un démontage. Ne pas interrompre le suivi pendant une session active.
- Risque de régression : moyen; vérifier que le GPS redémarre correctement après reconnexion.

### H8 - Données de suivi admin falsifiables côté client

- Fichier : `supabase/reset_rls.sql`, table `agent_positions`; code agent tracking adjacent.
- Problème : `email` est accepté depuis le client alors que l'identité est déjà disponible via `auth.uid()`.
- Impact : incohérence d'identité dans l'interface admin et données moins fiables.
- Correction proposée : dériver l'identité côté serveur ou ne pas stocker l'email client; conserver la policy basée sur `user_id = auth.uid()`.
- Risque de régression : faible à moyen; adapter le rendu admin et les migrations.

## MOYENNE

### M1 - Suppressions non représentées dans le delta sync

- Fichiers : `src/modules/census/dataLoader.js`, `src/db/database.js`, schéma SQL.
- Problème : `updated_at` permet les modifications, mais aucune stratégie explicite de tombstone/suppression n'est visible.
- Impact : une fiche supprimée côté serveur peut rester localement indéfiniment.
- Correction proposée : ajouter `deleted_at` ou journal de changements côté serveur, puis appliquer les suppressions uniquement dans les deltas complets et authentifiés.
- Risque de régression : moyen; les suppressions offline doivent être distinguées des absences de réponse.

### M2 - Pagination séquentielle coûteuse et sans annulation de cycle complet

- Fichier : `src/modules/census/dataLoader.js`, `fetchAllPages()`.
- Problème : jusqu'à 100 requêtes séquentielles; les timers par requête sont traités, mais il n'existe pas de contrôleur global de cancellation associé au cycle de chargement.
- Impact : consommation réseau/mémoire et travail poursuivi si la vue est abandonnée.
- Correction proposée : ajouter un signal de cycle seulement si un vrai besoin de teardown est confirmé; conserver le timeout local déjà présent.
- Risque de régression : moyen; annuler trop tôt pourrait empêcher un cache partiel utile.

### M3 - Recherche de doublons O(N) répétée

- Fichiers : `src/modules/census/censusFormModal.js`, `src/db/database.js`.
- Problème : le contrôle de proximité peut parcourir tous les points deux fois par saisie; le coût augmente sur appareils faibles et grands datasets.
- Impact : latence UI et consommation batterie à plusieurs milliers de points.
- Correction proposée : index spatial local ou recherche par grille/geohash, avec debounce conservé.
- Risque de régression : moyen; valider les coordonnées mixtes et le rayon.

### M4 - Couplage élevé de `appView.js`

- Fichier : `src/appView.js`.
- Problème : layout, événements, sync, stats, admin, export, navigation et rendu cohabitent dans un module de grande taille.
- Impact : changements risqués, tests UI difficiles, probabilité de régression accrue.
- Correction proposée : extraction progressive par responsabilité seulement lorsque la frontière est stable (`syncView`, `exportView`, `navigationView`), sans réécriture globale.
- Risque de régression : moyen à élevé selon l'extraction.

### M5 - Accessibilité incomplète des modales et de la carte

- Fichiers : `src/appView.js`, modales de `src/modules/census/`, `src/core/confirmModal.js`, styles.
- Problèmes : focus initial/restauration, focus trap, Escape et alternatives non visuelles ne sont pas uniformes; l'interface dépend parfois d'emojis/couleurs.
- Impact : usage clavier/lecteur d'écran dégradé et compréhension difficile sans vision des marqueurs.
- Correction proposée : normaliser le cycle de focus et les labels; ajouter `prefers-reduced-motion`; conserver les couleurs avec texte/état aria.
- Risque de régression : faible à moyen.

### M6 - CSP améliorable et seulement déclarée par meta

- Fichier : `index.html`.
- Problèmes : `style-src 'unsafe-inline'`, absence visible de `object-src`, `base-uri`, `form-action`; les headers HTTP ne sont pas contrôlés par GitHub Pages.
- Impact : surface XSS et protection dépendante du déploiement.
- Correction proposée : renforcer progressivement la CSP sans casser MapLibre, PWA, workers et fonts; compléter par headers de plateforme si migration possible.
- Risque de régression : moyen; valider toutes les ressources externes et workers.

### M7 - Stratégie PWA de mise à jour et cache à vérifier sur appareil

- Fichiers : `vite.config.js`, `src/core/pwa.js`, `src/core/lazyImport.js`.
- Problèmes : `autoUpdate` peut remplacer le worker pendant une session; le Background Sync réel n'est pas configuré; les chemins GitHub Pages doivent être validés sur installation Android/iOS.
- Impact : session terrain potentiellement sur ancienne/nouvelle version incohérente; reprise après fermeture limitée.
- Correction proposée : notification de mise à jour contrôlée, test d'installation et stratégie explicite de reload; documenter les limites lorsque l'app est fermée.
- Risque de régression : moyen.

### M8 - Documentation divergente du schéma

- Fichiers : `SECURITY.md`, `supabase/schema.sql`, `supabase/reset_rls.sql`, `README.md`.
- Problème : certaines descriptions de policies ne semblent pas alignées avec les scripts SQL actuels; la documentation présente l'offline comme complet alors que le Background Sync n'est pas réellement implémenté.
- Impact : mauvaises décisions d'exploitation et déploiement incomplet.
- Correction proposée : mettre à jour la documentation après validation du schéma réellement déployé; publier une procédure de vérification dashboard.
- Risque de régression : faible.

## FAIBLE

### F1 - Fichiers temporaires non suivis

- Fichiers : `5-tour-started.png`, `tourreport-check.tmp.cjs`.
- Problème : artefacts de diagnostic présents dans le worktree.
- Impact : pollution locale et risque de commit accidentel.
- Correction proposée : supprimer après confirmation ou les ajouter à une règle ciblée `.gitignore`.
- Risque de régression : faible.

### F2 - Actions GitHub non épinglées par hash

- Fichier : `.github/workflows/deploy.yml`.
- Problème : les tags `@v4` sont mutables.
- Impact : reproductibilité et chaîne d'approvisionnement moins robustes.
- Correction proposée : épingler à des SHA validés et documenter la procédure de mise à jour.
- Risque de régression : faible.

### F3 - Instrumentation console parfois verbeuse

- Fichiers : modules routing, sync, dataLoader et diagnostics.
- Problème : plusieurs logs opérationnels sont utiles, mais une revue systématique doit vérifier qu'aucun nom/téléphone/adresse ne passe en production hors mode verbose.
- Impact : risque de divulgation accidentelle dans les consoles et outils de collecte.
- Correction proposée : conserver le logger, redacter les données personnelles et limiter les logs de production.
- Risque de régression : faible.

## AMÉLIORATION

### A1 - Contrôle qualité et tests de scénarios terrain

- Ajouter tests d'intégration pour création offline, fermeture brutale simulée, reprise réseau, conflits et dead letters.
- Ajouter E2E Playwright pour login, création, offline/reprise, résolution de conflit et séparation agent/admin.
- Risque : coût de maintenance moyen, bénéfice élevé.

### A2 - Journal d'audit append-only

- Ajouter côté Supabase un journal minimal : utilisateur, action, entité, identifiant, timestamp et metadata minimisée.
- Couvrir visites, sync, conflits, résolution, rôles, administration et IA.
- Ne pas journaliser inutilement les données personnelles.

### A3 - Observabilité opérationnelle

- Ajouter compteurs de durée sync, taille de file, dead letters, conflits, taux de cache et erreurs par catégorie.
- Exposer un diagnostic admin sans révéler les données sensibles.

### A4 - Validation serveur des domaines métier

- Ajouter contraintes SQL pour coordonnées, statuts, longueurs et valeurs obligatoires.
- Ne jamais considérer le frontend comme autorité de sécurité.

## 10 corrections les plus importantes

1. Corriger le delta sync pour fusionner les deltas sans effacer les points inchangés.
2. Décider et appliquer le modèle RLS collaboratif ou propriétaire, puis tester les fiches importées.
3. Faire tourner/révoquer toutes les clés déjà présentes dans l'historique Git.
4. Retirer la clé ORS du navigateur via un proxy/Edge Function avec quotas.
5. Empêcher l'`upsert_point` de poursuivre après une vérification de version indisponible.
6. Garantir que `markPointSynced()` ne masque aucune mutation encore en attente.
7. Renforcer l'Edge Function IA : CORS, validation, limites, quotas, minimisation et erreurs génériques.
8. Rendre la CI bloquante sur lint, tests et build, puis épingler les actions.
9. Ajouter teardown GPS et une stratégie de rétention/minimisation des données locales.
10. Ajouter contraintes SQL, audit log et tests E2E des scénarios offline/conflit/admin.

## Vérifications externes obligatoires

### Dashboard Supabase

- RLS activé sur chaque table et policies réellement déployées.
- Version réellement déployée de `assert_visit_geofence()` et `admin_list_accounts()`.
- Trigger d'inscription et rôle initial des comptes.
- Rotation effective des clés historiques.
- URLs Auth, domaines autorisés, quotas et logs Edge Functions.
- Existence d'un journal d'audit et politique de rétention.

### Appareils réels

- Installation PWA sur Android et iOS au chemin GitHub Pages.
- Mise à jour worker pendant une saisie active.
- Fermeture forcée avec mutations en attente puis redémarrage.
- Reprise après coupure au milieu de la pagination.
- IndexedDB en navigation privée et navigateur intégré.
- GPS refusé, simulé, imprécis, ancien et batterie faible.
- Contraste plein soleil, clavier, lecteur d'écran et viewport étroit.

## Conclusion Phase 0

Le projet possède une base technique cohérente et une couverture de tests pure déjà utile. Les risques les plus urgents concernent l'intégrité du delta sync, le modèle RLS réellement compatible avec le workflow, les secrets historiques/ORS, et les protections serveur de l'IA. Aucune Phase 1 ne devrait commencer avant validation de ce rapport et décision explicite sur le modèle collaboratif des fiches.
