-- =============================================================
-- REINITIALISATION DU SCHEMA ANAREKA-CI
-- Crée les tables manquantes et remplace toutes les politiques RLS.
-- Les données existantes ne sont PAS supprimées.
-- =============================================================

-- =============================================================
-- 1. census_points
-- =============================================================
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
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE census_points ADD COLUMN IF NOT EXISTS etablissement TEXT NOT NULL DEFAULT '';
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT '';
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_census_points_block_order ON census_points (block, "order");
CREATE INDEX IF NOT EXISTS idx_census_points_status ON census_points (status);
CREATE INDEX IF NOT EXISTS idx_census_points_visited ON census_points (visited);
CREATE INDEX IF NOT EXISTS idx_census_points_created_by ON census_points (created_by);

ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert own or admin" ON census_points;
DROP POLICY IF EXISTS "Authenticated update own or admin" ON census_points;
DROP POLICY IF EXISTS "Admin delete access" ON census_points;

CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert own or admin"
  ON census_points FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Authenticated update own or admin"
  ON census_points FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Admin delete access"
  ON census_points FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- =============================================================
-- 2. user_roles
-- =============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin')),
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

-- =============================================================
-- 3. agent_positions
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

CREATE INDEX IF NOT EXISTS idx_agent_positions_user_id ON agent_positions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_positions_user_unique ON agent_positions (user_id);

ALTER TABLE agent_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can upsert own position" ON agent_positions;
DROP POLICY IF EXISTS "Authenticated can read agent positions" ON agent_positions;
DROP POLICY IF EXISTS "Admin can read all agent positions" ON agent_positions;

CREATE POLICY "Agents can upsert own position"
  ON agent_positions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin can read all agent positions"
  ON agent_positions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- =============================================================
-- 4. target_zones
-- =============================================================
CREATE TABLE IF NOT EXISTS target_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE target_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read target zones" ON target_zones;
DROP POLICY IF EXISTS "Authenticated can add target zones" ON target_zones;
DROP POLICY IF EXISTS "Authenticated can remove target zones" ON target_zones;
DROP POLICY IF EXISTS "Admin can manage target zones" ON target_zones;

CREATE POLICY "Authenticated can read target zones"
  ON target_zones FOR SELECT TO authenticated
  USING (true);

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
