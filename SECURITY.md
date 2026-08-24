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

## ✅ Modèle d'accès actuel (supabase/reset_rls.sql)

Le script `supabase/reset_rls.sql` crée les tables et applique les policies
suivantes. C'est la référence à exécuter dans le dashboard Supabase — les
exemples plus anciens de ce document (table `agent_zones`, colonne `bloc`)
ne correspondent PAS au schéma réel.

### Table `census_points`

| Opération | Qui | Condition |
|-----------|-----|-----------|
| SELECT | tout utilisateur authentifié | `USING (true)` — modèle collaboratif : chaque agent voit toutes les fiches pour couvrir sa zone |
| INSERT | agent | uniquement ses propres lignes (`created_by = auth.uid()`) ; admin : tout |
| UPDATE | agent | uniquement ses propres lignes ; admin : tout |
| DELETE | admin uniquement | rôle vérifié via `user_roles` |

> ℹ️ Le SELECT global est un choix produit assumé (recensement collaboratif).
> Pour restreindre par zone, ajouter une table d'affectation
> `agent_zones(agent_id, zone)` et remplacer le `USING (true)` par un filtre
> sur `quartier`/zone — la structure RLS ci-dessous s'y prête déjà.

### Tables de support

- `user_roles(user_id UNIQUE, role IN ('agent','admin'))` — lecture de son
  propre rôle seulement ; écriture réservée à `service_role`.
- `agent_positions` — chacun ne peut écrire/lire que SA position
  (`user_id = auth.uid()`) ; l'admin lit toutes les positions.
- `target_zones` — lecture pour tous les authentifiés ; gestion admin.

### ⚠️ Point d'attention documenté

La policy `USING (true)` en SELECT signifie : « toute personne authentifiée
peut lire toutes les fiches ». Ce n'est PAS une faille ouverte au public
anonyme (le rôle `anon` n'a aucun accès), mais un agent peut lire des fiches
hors de sa zone. Si le besoin de cloisonnement par zone devient réel,
appliquer la restriction décrite ci-dessus.

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
|----------|--------|
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
**security@anareka.ci** (ou ouvrir une issue privée sur GitHub).
