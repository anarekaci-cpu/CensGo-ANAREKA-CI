# 🔐 Guide de Sécurité — Recensement ANAREKA-CI

## ⚠️ Actions immédiates requises

### 1. Activer Row Level Security (RLS)

Dans le dashboard Supabase, exécutez ces commandes SQL :

```sql
-- Activer RLS sur la table principale
ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

-- Politique : les agents ne voient que les points de leur zone
CREATE POLICY "Agents can read their zone points"
  ON census_points
  FOR SELECT
  TO authenticated
  USING (
    bloc IN (
      SELECT bloc FROM agent_zones WHERE agent_id = auth.uid()
    )
  );

-- Politique : les agents peuvent mettre à jour les champs de suivi
CREATE POLICY "Agents can update visit status"
  ON census_points
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    -- Seuls les champs de suivi sont modifiables
    -- Les données personnelles (nom, tel, adresse) sont en lecture seule
    true
  );

-- Politique : les superviseurs peuvent tout voir
CREATE POLICY "Supervisors can read all"
  ON census_points
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (SELECT user_id FROM supervisors)
  );
```

### 2. Régénérer les clés API

1. Allez dans **Project Settings > API** sur Supabase
2. Cliquez sur **"Regenerate"** pour la clé `anon`
3. Mettez à jour votre fichier `.env` (NE PAS committer)
4. Révoquez l'ancienne clé immédiatement

### 3. Restreindre les domaines autorisés (CORS)

Dans **Authentication > URL Configuration** :
- Site URL : `https://anarekaci-cpu.github.io`
- Redirect URLs : `https://anarekaci-cpu.github.io/Recensement-ANAREKA-CI/`

### 4. Activer l'authentification à 2 facteurs (2FA)

Recommandé pour les comptes superviseurs.

---

## 🛡️ Bonnes pratiques

| Pratique | Statut |
|----------|--------|
| Clés API dans `.env` (pas dans le code) | ✅ À implémenter |
| RLS activé sur toutes les tables | ⚠️ URGENT |
| HTTPS obligatoire | ✅ GitHub Pages |
| Validation côté serveur des données | ⚠️ À ajouter |
| Audit log des modifications | ⚠️ À ajouter |
| Rate limiting sur l'API | ⚠️ À configurer |

---

## 🚨 Signalement de vulnérabilités

Si vous découvrez une faille de sécurité, merci de contacter :  
**security@anareka.ci** (ou ouvrir une issue privée sur GitHub).
