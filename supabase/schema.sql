-- =============================================================
-- Schéma Supabase pour Recensement ANAREKA-CI
-- Exécuter dans le SQL Editor du dashboard Supabase
-- Idempotent : peut être exécuté plusieurs fois sans erreur
-- =============================================================

-- 1. Table principale des points de recensement (restaurateurs, kiosques
--    d'attiéké, vendeurs ambulants et producteurs référencés par l'ANAREKA-CI)
CREATE TABLE IF NOT EXISTS census_points (
  point_id      TEXT PRIMARY KEY,
  block         INTEGER NOT NULL DEFAULT 1,
  "order"       INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL DEFAULT '',
  tel           TEXT NOT NULL DEFAULT '',
  etablissement TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL DEFAULT '',
  quartier      TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  produits      TEXT NOT NULL DEFAULT '',
  sexe          TEXT NOT NULL DEFAULT 'Homme',
  status        TEXT NOT NULL DEFAULT 'NON DEFINI',
  visited       BOOLEAN NOT NULL DEFAULT false,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1bis. Pour une table census_points déjà existante (créée avant ce
--       correctif) : ajoute les deux colonnes manquantes sans toucher aux
--       données déjà présentes.
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS etablissement TEXT NOT NULL DEFAULT '';
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT '';

-- 2. Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_census_points_block_order
  ON census_points (block, "order");

CREATE INDEX IF NOT EXISTS idx_census_points_status
  ON census_points (status);

CREATE INDEX IF NOT EXISTS idx_census_points_visited
  ON census_points (visited);

-- 3. Activer Row Level Security (RLS)
ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

-- 4. Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;

-- 5. Recréer les politiques
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert access"
  ON census_points FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update access"
  ON census_points FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete access"
  ON census_points FOR DELETE TO authenticated USING (true);

CREATE POLICY "Anonymous read access"
  ON census_points FOR SELECT TO anon USING (true);

-- =============================================================
-- Table des positions des agents terrain (suivi admin)
-- =============================================================
CREATE TABLE IF NOT EXISTS agent_positions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  accuracy   DOUBLE PRECISION,
  heading    DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_positions_user_id
  ON agent_positions (user_id);

-- Un agent ne peut avoir qu'une seule position (upsert par user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_positions_user_unique
  ON agent_positions (user_id);

ALTER TABLE agent_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can upsert own position" ON agent_positions;
DROP POLICY IF EXISTS "Authenticated can read agent positions" ON agent_positions;

CREATE POLICY "Agents can upsert own position"
  ON agent_positions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated can read agent positions"
  ON agent_positions FOR SELECT TO authenticated
  USING (true);

-- =============================================================
-- Table des rôles utilisateurs (configurable dans Supabase)
-- Admin peut gérer les rôles directement dans le dashboard :
--   INSERT INTO user_roles (user_id, role) VALUES ('uuid-de-l-agent', 'admin');
-- =============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role     TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own role" ON user_roles;
DROP POLICY IF EXISTS "Service role manages roles" ON user_roles;

CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages roles"
  ON user_roles FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
