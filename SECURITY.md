# 🔐 Guide de Sécurité — CensGo-ANAREKA-CI

## 🚨 Incident connu : clé Supabase exposée dans l'historique Git

Entre les commits `f67073f` et `09d5296`, un fichier `.env` contenant la vraie
URL de projet Supabase et la clé `anon` a été committé (7 commits), avant
d'être retiré du suivi. Le dépôt étant public, **ces valeurs restent
récupérables dans l'historique Git tant qu'elles n'ont pas été régénérées** —
voir l'étape « Régénérer les clés API » ci-dessous, à traiter en priorité.
Réécrire l'historique (`git filter-repo`) est possible mais nécessite un
force-push et la recréation des clones existants ; ce n'est utile qu'après
rotation de la clé, pour éviter de laisser traîner une référence morte.

> ⚠️ La clé exposée est la clé **anon** (publique par conception, protégée par
> RLS). Aucune clé `service_role` ne doit JAMAIS être placée dans le frontend :
> elle contourne RLS. Si une `service_role` a un jour été exposée, la révoquer
> immédiatement depuis le dashboard Supabase.

## 🔑 Note de rappel — Rotation des clés API Supabase

**À faire au moins une fois avant le déploiement terrain**, puis à chaque
suspicion de fuite (clé aperçue dans un log, un screenshot, un bundle, un
commit ; départ d'une personne ayant eu accès au dashboard).

### Clé `anon` (celle du bundle / `.env`)

1. Dashboard Supabase → **Project Settings → API → Project API keys**.
2. **Regenerate** la clé `anon` (⚠️ invalide l'ancienne immédiatement).
3. Mettre à jour `VITE_SUPABASE_ANON_KEY` dans :
   - le `.env` **local** (jamais commité — bloqué par `.githooks/pre-commit`) ;
   - le **secret GitHub Actions** utilisé par `.github/workflows/deploy.yml`
     (Settings → Secrets and variables → Actions) ;
   - toute autre CI / hébergement.
4. Redéployer (`npm run deploy` ou push sur `main`) et vérifier la connexion.
5. L'ancienne clé reste lisible dans l'historique Git public : après rotation,
   envisager `git filter-repo` + force-push pour retirer la référence morte
   (utile seulement une fois la clé révoquée).

### Clé `service_role` et secrets Edge Functions

- `service_role` : **jamais** dans le frontend / une variable `VITE_*`.
  Uniquement dans les secrets des Edge Functions (`supabase secrets set …`).
  En cas de fuite : Regenerate immédiat, puis
  `supabase functions deploy <fn>` pour chaque fonction concernée.
- `GEMINI_API_KEY`, credentials Google Sheets, `AI_ALLOWED_ORIGINS` : gérés
  via `supabase secrets`, à faire tourner selon la même règle. Redéploiement
  explicite de la fonction Edge requis après chaque changement.

### Après toute rotation

- Vérifier `Authentication → URL Configuration` (Site URL / Redirect URLs
  toujours restreints aux domaines de production).
- Confirmer qu'aucun `.env*` (hors `.env.example`) n'est suivi par Git :
  `git ls-files | grep -E '\.env'` ne doit renvoyer que `.env.example`.

## ✅ Modèle d'accès actuel (supabase/reset_rls.sql)

Le script `supabase/reset_rls.sql` crée les tables et applique les policies
suivantes. C'est la référence à exécuter dans le dashboard Supabase — les
exemples plus anciens de ce document (table `agent_zones`, colonne `bloc`)
ne correspondent PAS au schéma réel.

### Inscription libre-service et validation (rôle `NULL`)

`reset_rls.sql` installe un trigger `on_auth_user_created` : à chaque
`auth.signUp()`, une ligne `user_roles(user_id, role = NULL)` est créée
automatiquement (SECURITY DEFINER — le client `authenticated` n'a **aucune**
permission INSERT directe sur `user_roles`, donc un agent ne peut jamais
s'auto-approuver).

**Un compte `role = NULL` n'a accès à RIEN** : toutes les policies de
lecture/écriture des données passent par `is_approved_user()`, qui n'est vrai
que pour `role IN ('agent','admin')`. Concrètement, un compte fraîchement
inscrit voit une carte vide et ne peut rien écrire tant qu'un admin ne l'a
pas validé (`UPDATE user_roles SET role = 'agent' …`, depuis l'app via
`admin_list_accounts()` / la policy « Admin can update roles », ou le
dashboard). Vérifié dans le cadre de l'audit de finalisation.

> `is_admin_user()` / `is_approved_user()` sont `SECURITY DEFINER` avec
> `search_path` figé — indispensable : un `EXISTS(SELECT … FROM user_roles)`
> écrit en clair dans une policy **de** `user_roles` provoquerait une
> récursion RLS infinie (constaté en production).

### Table `census_points`

| Opération | Qui | Condition |
| ----------- | ----- | ----------- |
| SELECT | agent/admin **validé** | `USING (is_approved_user())` — un compte `role = NULL` ne voit aucune fiche |
| INSERT | agent validé | uniquement ses propres lignes (`created_by = auth.uid()`) ; admin : tout |
| UPDATE | agent validé | uniquement ses propres lignes ; admin : tout |
| DELETE | admin uniquement | rôle vérifié via `user_roles` |

> ℹ️ Parmi les comptes validés, le SELECT est global (recensement
> collaboratif : chaque agent voit toutes les fiches pour couvrir sa zone).
> Pour cloisonner par zone, ajouter une table d'affectation
> `agent_zones(agent_id, zone)` et remplacer `is_approved_user()` par
> `is_approved_user() AND EXISTS(… agent_zones … quartier)`.

### Tables de support

- `user_roles(user_id UNIQUE, role IN ('agent','admin') OR role IS NULL)` —
  chacun lit son propre rôle ; un **admin** lit tous les comptes (policy
  « Admin can read all roles ») et peut changer le rôle d'un autre compte
  (« Admin can update roles », jamais le sien). Aucun INSERT client (trigger
  SECURITY DEFINER only) ; `service_role` gère tout.
- `agent_positions` — chacun ne peut écrire/lire que SA position
  (`user_id = auth.uid()`) ; l'admin lit toutes les positions.
- `target_zones` — lecture pour tout compte validé (`is_approved_user()`) ;
  gestion (INSERT/UPDATE/DELETE) réservée à l'admin.

### ⚠️ Point d'attention documenté

Parmi les comptes **validés**, la lecture de `census_points` est globale :
un agent peut lire des fiches hors de sa zone. Ce n'est pas une faille
(aucun accès `anon`, aucun accès `role = NULL`), mais un choix produit. Si le
cloisonnement par zone devient nécessaire, appliquer la restriction décrite
ci-dessus.

### Anti-fraude "marquer visité" — fonction `assert_visit_geofence()`

Le contrôle de proximité GPS (empêcher un agent de cocher "visité" sans être
sur place) existait initialement uniquement en JS côté client
(`src/core/geofence.js`) — contournable par un appel direct à l'API Supabase
hors de l'application. `assert_visit_geofence()` (dans `reset_rls.sql` /
`schema.sql`) applique désormais ce contrôle côté serveur, à partir des
coordonnées GPS soumises par l'app au moment de l'action (capturées côté
client, aucun GPS serveur n'existe) ; appelée par `syncEngine.js` avant
chaque synchronisation d'un passage à `visited=true`. Les admins en sont
exemptés.

### Fonction Edge `ai-agent` — authentification du token

`supabase/functions/ai-agent/index.ts` ne vérifiait que la PRÉSENCE d'un
header `Authorization`, jamais qu'il appartienne à un compte réel et
approuvé — la clé `anon` publique (déjà dans le bundle client) suffisait à
passer ce test. N'importe qui pouvait donc appeler cette fonction (y
compris `vision_ocr`, coûteux) sans être inscrit ni validé, consommant le
quota `GEMINI_API_KEY` payant sans limite. La fonction valide maintenant la
session (`auth.getUser()`) et l'approbation du compte (`user_roles`) avant
d'appeler Gemini. **Redéploiement requis** : `supabase functions deploy
ai-agent` (ce correctif ne prend effet qu'après redéploiement manuel — il
ne peut pas être appliqué depuis ce dépôt seul).

## ⚠️ Actions requises avant production

### Edge Function IA

Définir le secret `AI_ALLOWED_ORIGINS` dans Supabase avec les origines
exactes de production et, si nécessaire, de développement. La fonction refuse
les requêtes portant une origine absente de cette liste, limite la taille des
payloads et des prompts, et ne renvoie plus les messages internes de Gemini.
Ces contrôles réduisent l'abus mais ne remplacent pas un quota persistant par
utilisateur : celui-ci doit être ajouté côté Supabase avant un usage IA à grande
échelle.

Après chaque modification de `supabase/functions/ai-agent/index.ts`, redéployer
explicitement la fonction et vérifier son statut dans le dashboard :

```bash
supabase functions deploy ai-agent
```

Ne jamais placer `GEMINI_API_KEY` dans une variable `VITE_*` ni dans le bundle
navigateur.

### Journal d'audit

Les scripts SQL créent la table `audit_events` et le trigger serveur des
mutations `census_points`. Après déploiement, vérifier que RLS est activé, que
seul un administrateur peut lire les événements et qu'un utilisateur
`authenticated` ne peut pas insérer directement dans cette table. Les
événements ne contiennent volontairement pas de nom, téléphone, adresse ou
coordonnées précises.

1. **Exécuter `supabase/reset_rls.sql`** dans le SQL Editor Supabase
   (idempotent : crée les tables manquantes, remplace les policies, ne
   supprime aucune donnée).
2. **Régénérer les clés API** : Project Settings → API → Regenerate `anon`,
   mettre à jour `.env` (jamais commité), révoquer l'ancienne.
3. **Restreindre les domaines** (Authentication → URL Configuration) :
   - Site URL : `https://anarekaci-cpu.github.io`
   - Redirect URLs : `https://anarekaci-cpu.github.io/CensGo-ANAREKA-CI/`
4. **Redéployer la fonction Edge `ai-agent`** : `supabase functions deploy
   ai-agent` — sans ça, le correctif d'authentification ci-dessus ne prend
   pas effet en production (le code de ce dépôt seul ne suffit pas, une
   fonction Edge doit être explicitement redéployée sur le projet Supabase).
5. Activer la 2FA sur les comptes superviseurs/admins.

---

## 🛡️ Bonnes pratiques

| Pratique | Statut |
| ---------- | -------- |
| Clés API dans `.env` uniquement (hook pre-commit anti-`.env`) | ✅ |
| RLS activé sur toutes les tables + policies par rôle | ✅ reset_rls.sql |
| Rotation de la clé anon exposée | ⚠️ À faire côté dashboard |
| HTTPS obligatoire | ✅ GitHub Pages |
| Pas de secret serveur / service_role dans le client | ✅ (anon only) |
| Échappement HTML systématique des données affichées | ✅ escapeHtml |
| Validation des coordonnées GPS côté client | ✅ isValidLatLng |
| Anti-fraude "marquer visité" appliqué côté serveur | ✅ assert_visit_geofence() |
| Fonction Edge `ai-agent` : authentification vérifiée | ✅ (à redéployer, voir ci-dessus) |
| Audit log des modifications | ⚠️ À ajouter |
| Rate limiting sur l'API | ⚠️ Configurable côté Supabase |

---

## 🚨 Signalement de vulnérabilités

Si vous découvrez une faille de sécurité, merci de contacter :  
[security@anareka.ci](mailto:security@anareka.ci) (ou ouvrir une issue privée sur GitHub).
