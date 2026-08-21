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
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1bis. Pour une table census_points déjà existante (créée avant ce
--       correctif) : ajoute les colonnes manquantes sans toucher aux
--       données déjà présentes.
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS etablissement TEXT NOT NULL DEFAULT '';
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT '';
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
-- created_at / zone : le code applicatif (normalize.js, popupModel.js) sait
-- déjà lire ces champs, mais ils n'étaient jamais réellement présents sur
-- census_points — les demander dans le SELECT de dataLoader.js faisait
-- échouer CHAQUE synchro avec l'erreur PostgREST 42703 (colonne inconnue).
-- Après avoir exécuté cette migration, "created_at" peut être remis dans
-- le SELECT de src/modules/census/dataLoader.js.
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS zone TEXT;

-- 2. Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_census_points_block_order
  ON census_points (block, "order");

CREATE INDEX IF NOT EXISTS idx_census_points_status
  ON census_points (status);

CREATE INDEX IF NOT EXISTS idx_census_points_visited
  ON census_points (visited);

CREATE INDEX IF NOT EXISTS idx_census_points_created_by
  ON census_points (created_by);

-- 3. Activer Row Level Security (RLS)
ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

-- 4. Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;
DROP POLICY IF EXISTS "Admin full access" ON census_points;

-- 5. Recréer les politiques avec scoping par rôle
--    Lecture : tous les agents authentifiés peuvent lire tous les points
--    (nécessaire pour la vue carte partagée entre agents)
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated
  USING (true);

--    Écriture : les agents ne peuvent insérer/modifier que leurs propres
--    points OU être admin (les admins gèrent les données de tous)
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

--    Suppression : admin uniquement
CREATE POLICY "Admin delete access"
  ON census_points FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

--    Suppression de l'accès anonyme (les données de recensement sont
--    confidentielles — positions GPS, téléphones, noms d'entreprises)
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;

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
DROP POLICY IF EXISTS "Admin can read all agent positions" ON agent_positions;

CREATE POLICY "Agents can upsert own position"
  ON agent_positions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

--    Lecture : admin uniquement (privacy — un agent ne doit pas voir
--    la position GPS en temps réel d'un autre agent)
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

-- =============================================================
-- Zones cibles : quartiers/villes que l'association veut voir couverts,
-- ajoutés AVANT qu'un agent n'y ait recensé le moindre établissement.
-- Sans ça, un quartier n'apparaît dans la couverture qu'après coup —
-- impossible de dire "il faut couvrir Venservin" tant que personne n'y est
-- allé. Avec cette table, un admin ajoute le nom et il apparaît tout de
-- suite dans le panneau de couverture à 0/0, comme objectif explicite.
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

--    Lecture : tous les agents (pour afficher les objectifs de couverture)
CREATE POLICY "Authenticated can read target zones"
  ON target_zones FOR SELECT TO authenticated
  USING (true);

--    Écriture/suppression : admin uniquement
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
