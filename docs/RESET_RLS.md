# Réinitialisation du Schéma RLS — ANAREKA-CI

## Instructions

1. Ouvre le dashboard Supabase → **SQL Editor**
2. Colle le code SQL ci-dessous
3. Clique **Run**
4. Vérifie qu'au moins un compte admin existe dans `user_roles`

> **⚠️ Préalable obligatoire** — Assure-toi qu'au moins un agent admin a un rôle :
> ```sql
> INSERT INTO user_roles (user_id, role)
> VALUES ('uuid-de-l-agent', 'admin')
> ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
> ```

---

## Code SQL

Le code SQL complet et à jour (inscription en libre-service, validation
admin, `is_approved_user()`) vit dans **`supabase/reset_rls.sql`** —
copie-colle directement ce fichier plutôt que le bloc ci-dessous, pour ne
jamais exécuter une version obsolète. Résumé de ce qu'il fait :

```sql
-- =============================================================
-- REINITIALISATION DU SCHEMA ANAREKA-CI
-- CETTE COMMANDE SUPPRIME ET RECRÉE TOUTES LES POLITIQUES RLS
-- Les données existantes dans les tables NE SONT PAS supprimées.
-- Seules les politiques de sécurité sont remplacées.
-- =============================================================

-- === user_roles (créée en premier — is_approved_user() est référencée
--     par les policies census_points/target_zones plus bas) ===
-- role NULL = inscrit mais pas encore validé par un admin : voir
-- supabase/reset_rls.sql pour la définition complète (colonnes
-- full_name/agent_number, trigger handle_new_user_role(),
-- fonction is_approved_user()).

-- === census_points ===

-- 1. Ajouter la colonne created_by si elle n'existe pas
ALTER TABLE census_points
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Supprimer les anciennes politiques
DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert own or admin" ON census_points;
DROP POLICY IF EXISTS "Authenticated update own or admin" ON census_points;
DROP POLICY IF EXISTS "Admin delete access" ON census_points;

-- 3. Créer les nouvelles politiques

-- Lecture : uniquement les comptes VALIDÉS (is_approved_user()) — un compte
-- fraîchement inscrit ne voit aucun point tant qu'un admin ne l'a pas
-- approuvé dans user_roles (carte vide par conception).
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated
  USING (is_approved_user());

-- Insertion : compte validé, ET (propriétaire OU admin)
CREATE POLICY "Authenticated insert own or admin"
  ON census_points FOR INSERT TO authenticated
  WITH CHECK (
    is_approved_user()
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
      )
    )
  );

-- Modification : compte validé, ET (propriétaire OU admin)
CREATE POLICY "Authenticated update own or admin"
  ON census_points FOR UPDATE TO authenticated
  USING (
    is_approved_user()
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
      )
    )
  )
  WITH CHECK (
    is_approved_user()
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
      )
    )
  );

-- Suppression : admin uniquement
CREATE POLICY "Admin delete access"
  ON census_points FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Supprimer l'accès anonyme (données confidentielles)
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;

-- Index sur created_by
CREATE INDEX IF NOT EXISTS idx_census_points_created_by
  ON census_points (created_by);


-- === agent_positions ===

DROP POLICY IF EXISTS "Agents can upsert own position" ON agent_positions;
DROP POLICY IF EXISTS "Authenticated can read agent positions" ON agent_positions;
DROP POLICY IF EXISTS "Admin can read all agent positions" ON agent_positions;

-- Upsert : chaque agent ne gère que sa propre position
CREATE POLICY "Agents can upsert own position"
  ON agent_positions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Lecture : admin uniquement (privacy GPS)
CREATE POLICY "Admin can read all agent positions"
  ON agent_positions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );


-- === target_zones ===

DROP POLICY IF EXISTS "Authenticated can read target zones" ON target_zones;
DROP POLICY IF EXISTS "Authenticated can add target zones" ON target_zones;
DROP POLICY IF EXISTS "Authenticated can remove target zones" ON target_zones;
DROP POLICY IF EXISTS "Admin can manage target zones" ON target_zones;

-- Lecture : comptes validés uniquement (objectifs de couverture)
CREATE POLICY "Authenticated can read target zones"
  ON target_zones FOR SELECT TO authenticated
  USING (is_approved_user());

-- Écriture/suppression : admin uniquement
CREATE POLICY "Admin can manage target zones"
  ON target_zones FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );
```

---

## Résumé des changements de sécurité

| Table | Avant | Après |
|---|---|---|
| `census_points` SELECT | Tous (y compris anonymes) | Agents authentifiés uniquement |
| `census_points` INSERT | N'importe qui | Propriétaire ou admin |
| `census_points` UPDATE | N'importe qui | Propriétaire ou admin |
| `census_points` DELETE | N'importe qui | Admin uniquement |
| `agent_positions` SELECT | N'importe qui | Admin uniquement |
| `target_zones` INSERT | N'importe qui | Admin uniquement |
| `target_zones` DELETE | N'importe qui | Admin uniquement |
| Accès anonyme | SELECT sur tout | **Supprimé** |
| `user_roles.role` | `NOT NULL DEFAULT 'agent'` (auto-agent) | `NULL` par défaut ("en attente"), approuvé manuellement |
| `census_points`/`target_zones` SELECT/INSERT/UPDATE | Tout compte authentifié | Uniquement un compte **validé** (`is_approved_user()`) |
