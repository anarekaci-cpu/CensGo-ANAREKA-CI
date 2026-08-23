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
-- NOTE : cette liste doit contenir TOUS les noms de policy créés plus bas
-- (y compris les noms remplacés lors de révisions passées) pour que le
-- script reste réellement idempotent — un nom de CREATE POLICY oublié ici
-- fait échouer toute réexécution avec "policy ... already exists" (42710).
DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON census_points;
DROP POLICY IF EXISTS "Admin full access" ON census_points;
DROP POLICY IF EXISTS "Authenticated insert own or admin" ON census_points;
DROP POLICY IF EXISTS "Authenticated update own or admin" ON census_points;
DROP POLICY IF EXISTS "Admin delete access" ON census_points;

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
-- Table des rôles utilisateurs.
--
-- Un agent crée lui-même son compte depuis l'app (Nom/Prénom + email/mot
-- de passe) : un trigger (handle_new_user_role(), défini plus bas dans ce
-- fichier) crée alors automatiquement sa ligne ici avec role=NULL. Tant que
-- role est NULL, RLS (voir is_approved_user() plus bas) lui refuse tout
-- accès aux données de recensement — carte vide jusqu'à validation.
--
-- Validation manuelle par un admin, dans le dashboard Supabase (Table
-- Editor > user_roles) ou en SQL :
--   UPDATE user_roles SET role = 'agent' WHERE user_id = 'uuid-de-l-agent';
--   -- ou role = 'admin' pour donner les droits d'administration
-- =============================================================
-- role NULL = en attente de validation (voir plus bas dans ce fichier pour
-- les colonnes full_name/agent_number et le trigger d'inscription, ajoutés
-- après coup sans casser une table déjà existante).
CREATE TABLE IF NOT EXISTS user_roles (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role     TEXT CHECK (role IS NULL OR role IN ('agent', 'admin')),
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

-- =============================================================
-- Inscription en libre-service + validation par un admin
--
-- Avant ce correctif, toute nouvelle ligne user_roles avait role='agent'
-- PAR DÉFAUT et rien n'empêchait un client authentifié d'insérer sa propre
-- ligne — un agent aurait donc pu s'auto-approuver. Le rôle est maintenant
-- NULL ("en attente") tant qu'un administrateur ne l'a pas explicitement
-- défini sur 'agent' ou 'admin' (dashboard Supabase, table user_roles), et
-- la ligne est créée automatiquement par un trigger côté serveur — jamais
-- par le client — au moment de l'inscription (supabase.auth.signUp()).
-- =============================================================

-- 1bis. Colonnes ajoutées à un user_roles déjà existant, sans toucher aux
--       lignes (et donc aux rôles) déjà attribuées.
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS agent_number INTEGER;

ALTER TABLE user_roles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE user_roles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IS NULL OR role IN ('agent', 'admin'));

-- Numérotation des agents (#1, #2, ...) affichée dans l'app pour qu'un agent
-- s'identifie lui-même une fois son compte créé — indépendante de l'ordre
-- d'approbation par l'admin.
CREATE SEQUENCE IF NOT EXISTS agent_number_seq;
ALTER TABLE user_roles ALTER COLUMN agent_number SET DEFAULT nextval('agent_number_seq');
-- Attribue rétroactivement un numéro aux lignes déjà existantes qui n'en
-- ont pas (comptes créés avant ce correctif, via le dashboard).
UPDATE user_roles SET agent_number = nextval('agent_number_seq') WHERE agent_number IS NULL;

-- 2. Trigger : à chaque inscription (auth.users), crée automatiquement la
--    ligne user_roles correspondante avec role=NULL. SECURITY DEFINER : le
--    trigger s'exécute avec les droits du propriétaire de la fonction (pas
--    ceux du nouvel utilisateur), c'est la SEULE façon dont une ligne
--    user_roles peut être créée en dehors du dashboard admin — le client
--    (rôle "authenticated") n'a toujours aucune permission INSERT dessus.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_role();

-- 3. Fonction réutilisée par les policies ci-dessous : true seulement pour
--    un compte explicitement validé par un admin (role='agent' ou 'admin').
--    Un compte fraîchement inscrit (role=NULL) échoue partout, donc ne voit
--    aucun point sur la carte tant qu'il n'est pas approuvé.
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

-- 3bis. Validation des comptes DEPUIS L'APPLICATION (pas seulement le
--       dashboard Supabase) : un admin doit pouvoir voir tous les comptes
--       (notamment ceux en attente, role IS NULL) et changer leur rôle.
--       Ces policies s'AJOUTENT à "Users can read own role" (permissives,
--       combinées en OR) — un agent/compte en attente continue de ne voir
--       que sa propre ligne, seul un admin voit tout.
DROP POLICY IF EXISTS "Admin can read all roles" ON user_roles;
CREATE POLICY "Admin can read all roles"
  ON user_roles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admin can update roles" ON user_roles;
CREATE POLICY "Admin can update roles"
  ON user_roles FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- 4. Durcissement des policies existantes : "authenticated" ne suffit plus,
--    il faut être un compte APPROUVÉ. Remplace les policies définies plus
--    haut dans ce fichier (mêmes noms, DROP+CREATE déjà fait plus haut pour
--    la lecture — on ajoute ici la condition d'approbation).
DROP POLICY IF EXISTS "Authenticated read access" ON census_points;
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS "Authenticated insert own or admin" ON census_points;
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

DROP POLICY IF EXISTS "Authenticated update own or admin" ON census_points;
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

DROP POLICY IF EXISTS "Authenticated can read target zones" ON target_zones;
CREATE POLICY "Authenticated can read target zones"
  ON target_zones FOR SELECT TO authenticated
  USING (is_approved_user());

-- Un compte en attente doit pouvoir lire SA PROPRE ligne (rôle, numéro
-- d'agent, nom) pour que l'app affiche "Compte en attente — Agent #N" —
-- la policy "Users can read own role" plus haut couvre déjà ce cas
-- (USING (user_id = auth.uid()), sans condition de rôle), aucun changement
-- nécessaire ici.
