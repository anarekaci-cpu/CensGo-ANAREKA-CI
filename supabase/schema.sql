-- =============================================================
-- Schéma Supabase pour Recensement ANAREKA-CI
-- Exécuter dans le SQL Editor du dashboard Supabase
-- =============================================================

-- 1. Table principale des points de recensement
CREATE TABLE IF NOT EXISTS census_points (
  point_id   UUID PRIMARY KEY,
  block      INTEGER NOT NULL DEFAULT 1,
  "order"    INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL DEFAULT '',
  tel        TEXT NOT NULL DEFAULT '',
  quartier   TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  produits   TEXT NOT NULL DEFAULT '',
  sexe       TEXT NOT NULL DEFAULT 'Homme',
  status     TEXT NOT NULL DEFAULT 'NON DEFINI',
  visited    BOOLEAN NOT NULL DEFAULT false,
  lat        DOUBLE PRECISION,
  lon        DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_census_points_block_order
  ON census_points (block, "order");

CREATE INDEX IF NOT EXISTS idx_census_points_status
  ON census_points (status);

CREATE INDEX IF NOT EXISTS idx_census_points_visited
  ON census_points (visited);

-- 3. Activer Row Level Security (RLS)
ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

-- 4. Politique : les utilisateurs authentifiés peuvent tout lire
CREATE POLICY "Authenticated read access"
  ON census_points
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Politique : les utilisateurs authentifiés peuvent insérer
CREATE POLICY "Authenticated insert access"
  ON census_points
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. Politique : les utilisateurs authentifiés peuvent mettre à jour
CREATE POLICY "Authenticated update access"
  ON census_points
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Politique : les utilisateurs authentifiés peuvent supprimer
CREATE POLICY "Authenticated delete access"
  ON census_points
  FOR DELETE
  TO authenticated
  USING (true);

-- 8. Politique ANONYMOUS : lecture seule (pour usage hors-ligne sans auth)
CREATE POLICY "Anonymous read access"
  ON census_points
  FOR SELECT
  TO anon
  USING (true);
