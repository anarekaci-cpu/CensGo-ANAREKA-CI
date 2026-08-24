-- =============================================================
-- REINITIALISATION DU SCHEMA ANAREKA-CI
-- Crée les tables manquantes et remplace toutes les politiques RLS.
-- Les données existantes ne sont PAS supprimées.
-- =============================================================

-- =============================================================
-- 0. user_roles + inscription en libre-service
--    (créée en premier : les policies census_points plus bas référencent
--    is_approved_user(), qui doit donc déjà exister)
--
--    role NULL = compte inscrit mais pas encore validé par un admin — RLS
--    lui refuse alors tout accès aux données de recensement (carte vide).
--    Validation manuelle, dashboard Supabase (Table Editor > user_roles) :
--      UPDATE user_roles SET role = 'agent' WHERE user_id = 'uuid-agent';
-- =============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role       TEXT CHECK (role IS NULL OR role IN ('agent', 'admin')),
  full_name  TEXT,
  agent_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS agent_number INTEGER;
ALTER TABLE user_roles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE user_roles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IS NULL OR role IN ('agent', 'admin'));

CREATE SEQUENCE IF NOT EXISTS agent_number_seq;
ALTER TABLE user_roles ALTER COLUMN agent_number SET DEFAULT nextval('agent_number_seq');
UPDATE user_roles SET agent_number = nextval('agent_number_seq') WHERE agent_number IS NULL;

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

-- Validation des comptes DEPUIS L'APPLICATION : un admin voit tous les
-- comptes (notamment ceux en attente, role IS NULL) et peut changer leur
-- rôle, sans passer par le dashboard Supabase. S'ajoute (OR) à la policy
-- "Users can read own role" ci-dessus.
--
-- is_admin_user() est SECURITY DEFINER — INDISPENSABLE ici, pas juste une
-- bonne pratique : un EXISTS(SELECT ... FROM user_roles ...) écrit EN
-- CLAIR dans une policy DE user_roles s'exécute avec les droits de
-- l'appelant, donc redéclenche l'évaluation RLS de user_roles pour cette
-- sous-requête → réévalue la même policy → relance la sous-requête, etc.
-- ("infinite recursion detected in policy for relation user_roles",
-- confirmé en production — cassait aussi agent_positions/target_zones,
-- dont les policies sous-interrogent également user_roles). SECURITY
-- DEFINER fait tourner la sous-requête interne avec les droits du
-- propriétaire (postgres, qui contourne RLS) : plus de récursion.
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_user() TO authenticated;

DROP POLICY IF EXISTS "Admin can read all roles" ON user_roles;
CREATE POLICY "Admin can read all roles"
  ON user_roles FOR SELECT TO authenticated
  USING (is_admin_user());

DROP POLICY IF EXISTS "Admin can update roles" ON user_roles;
CREATE POLICY "Admin can update roles"
  ON user_roles FOR UPDATE TO authenticated
  USING (is_admin_user() AND user_id <> auth.uid())
  WITH CHECK (is_admin_user() AND user_id <> auth.uid());

-- user_roles ne contient jamais l'e-mail (auth.users n'est pas lisible par
-- le client "authenticated") — cette fonction jointe à auth.users tourne en
-- SECURITY DEFINER et vérifie ELLE-MÊME que l'appelant est admin avant de
-- renvoyer quoi que ce soit (0 ligne sinon, jamais une erreur).
CREATE OR REPLACE FUNCTION admin_list_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  full_name TEXT,
  agent_number INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ur.user_id, au.email, ur.role, ur.full_name, ur.agent_number
  FROM user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE EXISTS (
    SELECT 1 FROM user_roles me
    WHERE me.user_id = auth.uid() AND me.role = 'admin'
  )
  ORDER BY (ur.role IS NOT NULL), ur.agent_number;
$$;

REVOKE ALL ON FUNCTION admin_list_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_accounts() TO authenticated;

-- Backfill : comptes créés avant ce correctif — récupère un full_name déjà
-- présent dans les métadonnées auth, sans écraser un nom déjà renseigné.
UPDATE user_roles ur
SET full_name = au.raw_user_meta_data->>'full_name'
FROM auth.users au
WHERE au.id = ur.user_id
  AND ur.full_name IS NULL
  AND au.raw_user_meta_data->>'full_name' IS NOT NULL;

-- Trigger : crée automatiquement la ligne user_roles (role=NULL) à chaque
-- inscription (supabase.auth.signUp()). SECURITY DEFINER : seul ce trigger
-- peut créer une ligne — le client "authenticated" n'a aucune permission
-- INSERT sur user_roles, donc un agent ne peut jamais s'auto-approuver.
CREATE OR REPLACE FUNCTION handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role, full_name)
  VALUES (NEW.id, NULL, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION handle_new_user_role() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_role();

-- Réutilisée par toutes les policies de lecture/écriture ci-dessous : true
-- seulement pour un compte validé (role='agent' ou 'admin').
CREATE OR REPLACE FUNCTION is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('agent', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION is_approved_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_approved_user() TO authenticated;

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

-- Lecture/écriture réservées aux comptes VALIDÉS (is_approved_user()) — un
-- compte fraîchement inscrit (role NULL) ne voit et ne peut écrire aucun
-- point tant qu'un admin ne l'a pas approuvé.
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated
  USING (is_approved_user());

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
-- 2. agent_positions
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
-- 3. target_zones
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
  USING (is_approved_user());

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

-- =============================================================
-- 3. Anti-fraude "marquer visité" — application côté SERVEUR (audit sécu)
-- Voir schema.sql pour le commentaire complet. Fonction de VALIDATION SEULE
-- (aucun UPDATE) : syncEngine.js l'appelle juste avant sa mise à jour
-- conditionnelle existante (baseUpdatedAt, détection de conflit) plutôt que
-- de la remplacer — préserve cette détection au lieu de la perdre derrière
-- un UPDATE inconditionnel côté serveur.
-- =============================================================
CREATE OR REPLACE FUNCTION assert_visit_geofence(p_point_id TEXT, p_lat DOUBLE PRECISION, p_lon DOUBLE PRECISION)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_lat DOUBLE PRECISION;
  target_lon DOUBLE PRECISION;
  dist_m DOUBLE PRECISION;
  max_radius_m CONSTANT DOUBLE PRECISION := 500;
BEGIN
  IF is_admin_user() THEN
    RETURN;
  END IF;

  SELECT lat, lon INTO target_lat, target_lon
  FROM census_points WHERE point_id = p_point_id;

  IF NOT FOUND OR target_lat IS NULL OR target_lon IS NULL THEN
    RETURN;
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RAISE EXCEPTION 'Position GPS requise pour marquer ce point visité.';
  END IF;

  dist_m := 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(p_lat)) * cos(radians(target_lat)) * cos(radians(target_lon) - radians(p_lon))
      + sin(radians(p_lat)) * sin(radians(target_lat))
    ))
  );
  IF dist_m > max_radius_m THEN
    RAISE EXCEPTION 'Trop loin du point (% m, max % m autorisés)', round(dist_m::numeric, 0), max_radius_m;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION assert_visit_geofence(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_visit_geofence(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- Journal serveur minimal : l'identité et l'opération sont dérivées par le
-- trigger, jamais acceptées comme preuve depuis le frontend. Les champs
-- personnels des fiches ne sont volontairement pas copiés dans metadata.
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read audit events" ON audit_events;
CREATE POLICY "Admin can read audit events"
  ON audit_events FOR SELECT TO authenticated
  USING (is_admin_user());

CREATE OR REPLACE FUNCTION audit_census_point_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), lower(TG_OP), 'census_point', COALESCE(NEW.point_id, OLD.point_id),
    jsonb_build_object('visited', COALESCE(NEW.visited, OLD.visited), 'status', COALESCE(NEW.status, OLD.status)));
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION audit_census_point_changes() FROM PUBLIC;
DROP TRIGGER IF EXISTS census_points_audit_trigger ON census_points;
CREATE TRIGGER census_points_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON census_points
  FOR EACH ROW EXECUTE FUNCTION audit_census_point_changes();
