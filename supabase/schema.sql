-- =============================================================
-- Schéma Supabase pour Recensement ANAREKA-CI  (SCRIPT DE RÉFÉRENCE)
--
-- ORDRE D'EXÉCUTION (SQL Editor du dashboard, ou `psql -f`) :
--   1. schema.sql                (ce fichier : tables de base, helpers de
--                                 rôle, policies durcies, triggers)
--   2. add_cities.sql, add_census_photos.sql, add_invites.sql,
--      add_tour_sessions.sql, add_hazard_markers.sql, add_sheets_sync.sql,
--      add_spatial_bbox.sql      (dans n'importe quel ordre entre eux)
--   3. harden_function_grants.sql (EN DERNIER : retire EXECUTE à anon sur
--                                 toutes les fonctions créées ci-dessus)
--   fix_read_access.sql / reset_rls.sql : scripts de DÉPANNAGE seulement,
--   voir leur en-tête (ils ne remplacent pas schema.sql).
--
-- Fonctionne sur une base VIERGE (les helpers is_admin_user() /
-- is_approved_user() sont définis AVANT toute policy qui les utilise) et
-- sur une base existante : idempotent, ne supprime aucune donnée. Aucune
-- policy "USING (true)" transitoire n'est créée : seules les versions
-- durcies existent, y compris pendant l'exécution du script.
--
-- Conventions : (SELECT auth.uid()) / (SELECT public.is_*_user()) dans les
-- policies (évalué une fois par requête, pas par ligne) ; fonctions avec
-- SET search_path = '' et noms qualifiés.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Rôles utilisateurs (créés EN PREMIER : tout le reste en dépend)
--
-- Un agent crée lui-même son compte (signUp) : le trigger
-- handle_new_user_role() crée sa ligne avec role=NULL ("en attente"). Tant
-- que role est NULL, RLS (is_approved_user()) lui refuse tout accès aux
-- données. Validation par un admin (app, ou dashboard) :
--   UPDATE user_roles SET role = 'agent' WHERE user_id = 'uuid';
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role         TEXT CHECK (role IS NULL OR role IN ('agent', 'admin')),
  full_name    TEXT,
  agent_number INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pour une table user_roles créée par une ancienne version du script.
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS agent_number INTEGER;
ALTER TABLE public.user_roles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.user_roles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IS NULL OR role IN ('agent', 'admin'));

-- Numérotation des agents (#1, #2, ...), indépendante de l'ordre d'approbation.
CREATE SEQUENCE IF NOT EXISTS public.agent_number_seq;
ALTER TABLE public.user_roles ALTER COLUMN agent_number SET DEFAULT nextval('public.agent_number_seq');
UPDATE public.user_roles SET agent_number = nextval('public.agent_number_seq') WHERE agent_number IS NULL;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Helpers de rôle. SECURITY DEFINER = INDISPENSABLE : un EXISTS(... FROM
-- user_roles) écrit en clair dans une policy DE user_roles redéclenche RLS
-- sur user_roles -> "infinite recursion detected in policy" (constaté en
-- production, cassait aussi agent_positions/target_zones). Exécutés avec les
-- droits du propriétaire, ils contournent RLS et cassent la récursion.
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

-- true seulement pour un compte validé par un admin (agent ou admin).
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid()) AND role IN ('agent', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_user() TO authenticated;

-- Trigger d'inscription : crée la ligne user_roles (role=NULL). SECURITY
-- DEFINER : c'est la SEULE façon de créer une ligne hors dashboard — le
-- client "authenticated" n'a aucune permission INSERT sur user_roles.
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role, full_name)
  VALUES (NEW.id, NULL, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
DROP POLICY IF EXISTS "Service role manages roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin can update roles" ON public.user_roles;

CREATE POLICY "Users can read own role"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Service role manages roles"
  ON public.user_roles FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admin can read all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- Un admin change le rôle d'un AUTRE compte, jamais le sien.
CREATE POLICY "Admin can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin_user()) AND user_id <> (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_admin_user()) AND user_id <> (SELECT auth.uid()));

-- Liste des comptes avec e-mail pour l'admin (auth.users n'est pas lisible
-- par le client). Vérifie ELLE-MÊME que l'appelant est admin : 0 ligne sinon.
CREATE OR REPLACE FUNCTION public.admin_list_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  full_name TEXT,
  agent_number INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT ur.user_id, au.email::text, ur.role, ur.full_name, ur.agent_number
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE (SELECT public.is_admin_user())
  ORDER BY (ur.role IS NOT NULL), ur.agent_number;
$$;

REVOKE ALL ON FUNCTION public.admin_list_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts() TO authenticated;

-- Backfill (comptes antérieurs) : récupère full_name depuis les métadonnées
-- auth sans écraser un nom déjà renseigné. Rejouable sans effet.
UPDATE public.user_roles ur
SET full_name = au.raw_user_meta_data->>'full_name'
FROM auth.users au
WHERE au.id = ur.user_id
  AND ur.full_name IS NULL
  AND au.raw_user_meta_data->>'full_name' IS NOT NULL;

-- -------------------------------------------------------------
-- 1. Table principale des points de recensement
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.census_points (
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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  zone          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table census_points préexistante (créée par une ancienne version).
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS etablissement TEXT NOT NULL DEFAULT '';
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT '';
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS zone TEXT;

-- Preuve de position soumise PAR LE CLIENT dans la même ligne que le passage
-- à visited=true (voir enforce_visit_geofence() plus bas) : coordonnées GPS
-- du téléphone, précision (m) et horodatage du fix.
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS visit_lat      DOUBLE PRECISION;
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS visit_lon      DOUBLE PRECISION;
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS visit_accuracy DOUBLE PRECISION;
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS visit_at       TIMESTAMPTZ;

-- Index. idx_census_points_visited (booléen, très peu sélectif) est
-- conservé mais candidat à suppression si pg_stat_user_indexes montre
-- idx_scan = 0.
CREATE INDEX IF NOT EXISTS idx_census_points_block_order ON public.census_points (block, "order");
CREATE INDEX IF NOT EXISTS idx_census_points_status      ON public.census_points (status);
CREATE INDEX IF NOT EXISTS idx_census_points_visited     ON public.census_points (visited);
CREATE INDEX IF NOT EXISTS idx_census_points_created_by  ON public.census_points (created_by);

-- Contraintes d'intégrité en NOT VALID : appliquées à toute NOUVELLE écriture
-- sans bloquer sur des données historiques éventuellement sales. Quand
-- la requête SELECT point_id FROM census_points WHERE NOT (condition) ne
-- renvoie plus rien, valider avec :
--   ALTER TABLE public.census_points VALIDATE CONSTRAINT nom_contrainte;
-- (le bloc DO ne recrée pas une contrainte déjà présente/validée).
-- Valeurs déduites du client : sexe = Homme/Femme (censusFormModal.js) ;
-- status = NON DEFINI ou COULEUR (libellé) avec VERT/JAUNE/ROUGE/VIOLET
-- (appView.js) ; tel formaté "07 08 09 10 11" (formatPhoneCI) ou vide.
-- Note : \Z = fin de chaîne en regex PostgreSQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_lat_range') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_lat_range
      CHECK (lat IS NULL OR lat BETWEEN -90 AND 90) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_lon_range') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_lon_range
      CHECK (lon IS NULL OR lon BETWEEN -180 AND 180) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_sexe_check') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_sexe_check
      CHECK (sexe IN ('Homme', 'Femme')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_status_check') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_status_check
      CHECK (status = 'NON DEFINI' OR status ~ '^(VERT|JAUNE|ROUGE|VIOLET|BLEU|ORANGE)( \(.{1,60}\))?\Z') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_name_len') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_name_len
      CHECK (char_length(name) < 200) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_text_lens') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_text_lens
      CHECK (char_length(etablissement) < 200 AND char_length(activity_type) < 100
         AND char_length(quartier) < 200 AND char_length(address) < 500
         AND char_length(produits) < 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_tel_format') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_tel_format
      CHECK (tel = '' OR tel ~ '^[0-9+ ]{8,20}\Z') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.census_points'::regclass AND conname = 'census_points_visit_proof_check') THEN
    ALTER TABLE public.census_points ADD CONSTRAINT census_points_visit_proof_check
      CHECK ((visit_lat IS NULL OR visit_lat BETWEEN -90 AND 90)
         AND (visit_lon IS NULL OR visit_lon BETWEEN -180 AND 180)
         AND (visit_accuracy IS NULL OR visit_accuracy >= 0)) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.census_points ENABLE ROW LEVEL SECURITY;

-- Liste exhaustive des policies (y compris anciens noms) : réexécution sans
-- erreur 42710, et aucune ancienne policy permissive ne survit.
DROP POLICY IF EXISTS "Authenticated read access" ON public.census_points;
DROP POLICY IF EXISTS "Authenticated insert access" ON public.census_points;
DROP POLICY IF EXISTS "Authenticated update access" ON public.census_points;
DROP POLICY IF EXISTS "Authenticated delete access" ON public.census_points;
DROP POLICY IF EXISTS "Anonymous read access" ON public.census_points;
DROP POLICY IF EXISTS "Admin full access" ON public.census_points;
DROP POLICY IF EXISTS "Authenticated insert own or admin" ON public.census_points;
DROP POLICY IF EXISTS "Authenticated update own or admin" ON public.census_points;
DROP POLICY IF EXISTS "Admin delete access" ON public.census_points;

-- Lecture : comptes approuvés (carte partagée entre agents). Aucun accès
-- anonyme (positions GPS, téléphones, noms d'entreprises = confidentiel).
CREATE POLICY "Authenticated read access"
  ON public.census_points FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

-- Écriture : ses propres points, ou admin. Les règles fines (géofence,
-- immutabilité des coordonnées) sont dans enforce_visit_geofence().
CREATE POLICY "Authenticated insert own or admin"
  ON public.census_points FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_approved_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin_user()))
  );

CREATE POLICY "Authenticated update own or admin"
  ON public.census_points FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_approved_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin_user()))
  )
  WITH CHECK (
    (SELECT public.is_approved_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin_user()))
  );

CREATE POLICY "Admin delete access"
  ON public.census_points FOR DELETE TO authenticated
  USING ((SELECT public.is_admin_user()));

-- -------------------------------------------------------------
-- 2. updated_at maintenu côté serveur
--
-- Si le client ne change pas updated_at, le serveur le met à now(). Si le
-- client l'envoie (comportement actuel : horloge client), on le respecte
-- pour ne pas fabriquer de faux conflits dans la détection d'édition
-- concurrente (syncEngine.js : .eq("updated_at", baseUpdatedAt)).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS census_points_set_updated_at ON public.census_points;
CREATE TRIGGER census_points_set_updated_at
  BEFORE UPDATE ON public.census_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------
-- 3. Anti-fraude "marquer visité" appliqué par le SERVEUR (géofence)
--
-- Avant : contrôle uniquement en JS, et assert_visit_geofence() n'était
-- qu'un RPC OPTIONNEL appelé par le client : un appel direct
-- update({visited:true}) le contournait. Désormais le trigger
-- enforce_visit_geofence() (BEFORE INSERT OR UPDATE) s'applique à TOUTE
-- écriture d'un non-admin, quel que soit le chemin (REST, upsert, RPC).
--
-- Preuve de position : le client envoie, DANS LA MÊME LIGNE que
-- visited=true, visit_lat / visit_lon / visit_accuracy / visit_at (fix GPS
-- capturé au moment du clic). Le serveur ne possède pas de GPS : cette
-- preuve reste déclarative, mais elle est obligatoire, datée (≤ 7 jours, pas dans le futur,
-- constantes max_fix_age / max_fix_skew ci-dessous) et comparée aux coordonnées du POINT
-- stockées en base (immuables pour un non-admin), pas à celles envoyées.
--
-- Exemptés : admins, et sessions sans auth.uid() (service_role, SQL editor,
-- imports/migrations) : ils ne passent pas par le client.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_m(
  lat1 DOUBLE PRECISION, lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2) - radians(lon1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- Coeur du contrôle, appelable avec les coordonnées du point (INSERT/UPDATE
-- via le trigger, ou point déjà stocké via assert_visit_geofence()).
CREATE OR REPLACE FUNCTION public.check_visit_distance(
  p_target_lat DOUBLE PRECISION, p_target_lon DOUBLE PRECISION,
  p_lat DOUBLE PRECISION, p_lon DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  dist_m DOUBLE PRECISION;
  max_radius_m CONSTANT DOUBLE PRECISION := 500;
BEGIN
  IF p_target_lat IS NULL OR p_target_lon IS NULL THEN
    RAISE EXCEPTION 'Point sans coordonnées : impossible de vérifier la proximité.';
  END IF;
  -- Coordonnées de l'agent absentes : ne dispense PAS du contrôle.
  IF p_lat IS NULL OR p_lon IS NULL THEN
    RAISE EXCEPTION 'Position GPS requise pour marquer ce point visité.';
  END IF;
  dist_m := public.haversine_m(p_lat, p_lon, p_target_lat, p_target_lon);
  IF dist_m > max_radius_m THEN
    RAISE EXCEPTION 'Trop loin du point (% m, max % m autorisés)', round(dist_m::numeric, 0), max_radius_m;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_visit_distance(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_visit_distance(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
REVOKE ALL ON FUNCTION public.haversine_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haversine_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- RPC historique (contrat client inchangé : syncEngine.js l'appelle encore).
-- Validation seule, sur un point DÉJÀ stocké. Reste utile en pré-contrôle ;
-- la garantie réelle est désormais le trigger ci-dessous.
CREATE OR REPLACE FUNCTION public.assert_visit_geofence(p_point_id TEXT, p_lat DOUBLE PRECISION, p_lon DOUBLE PRECISION)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  target_lat DOUBLE PRECISION;
  target_lon DOUBLE PRECISION;
BEGIN
  IF (SELECT public.is_admin_user()) THEN
    RETURN;
  END IF;

  SELECT lat, lon INTO target_lat, target_lon
  FROM public.census_points WHERE point_id = p_point_id;

  -- Point introuvable (pas encore synchronisé) : rien à comparer ici ; le
  -- trigger tranchera à l'écriture réelle.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.check_visit_distance(target_lat, target_lon, p_lat, p_lon);
END;
$$;

REVOKE ALL ON FUNCTION public.assert_visit_geofence(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_visit_geofence(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_visit_geofence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- Fenêtre de validité du fix GPS (visit_at) par rapport à l'heure serveur.
  -- Offline-first : une visite peut être synchronisée longtemps après le clic,
  -- donc on tolère un fix ancien (max_fix_age) mais pas un fix dans le futur
  -- (max_fix_skew = dérive d'horloge du téléphone).
  max_fix_age  CONSTANT INTERVAL := INTERVAL '7 days';
  max_fix_skew CONSTANT INTERVAL := INTERVAL '2 minutes';
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT public.is_admin_user()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- upsert() sur une fiche existante : PostgREST exécute d'abord ce
    -- trigger INSERT, puis ON CONFLICT DO UPDATE déclenche le trigger
    -- UPDATE (règles ci-dessous appliquées contre l'ancienne ligne). On
    -- laisse donc passer ici pour ne pas rejeter à tort un upsert légitime.
    IF EXISTS (SELECT 1 FROM public.census_points WHERE point_id = NEW.point_id) THEN
      RETURN NEW;
    END IF;

    IF NEW.lat IS NULL OR NEW.lon IS NULL THEN
      RAISE EXCEPTION 'Coordonnées GPS obligatoires pour créer une fiche.';
    END IF;
    IF NEW.visited THEN
      RAISE EXCEPTION 'Une fiche ne peut pas être créée directement visitée.';
    END IF;
    NEW.visit_lat := NULL;
    NEW.visit_lon := NULL;
    NEW.visit_accuracy := NULL;
    NEW.visit_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE : coordonnées du point immuables dès qu'elles existent (sinon
  -- déplacer le point sous l'agent contournerait la distance).
  IF OLD.lat IS NOT NULL AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lon IS DISTINCT FROM OLD.lon) THEN
    RAISE EXCEPTION 'Les coordonnées d''une fiche ne sont pas modifiables.';
  END IF;

  IF NEW.visited AND NOT OLD.visited THEN
    IF NEW.lat IS NULL OR NEW.lon IS NULL THEN
      RAISE EXCEPTION 'Fiche sans coordonnées : impossible de la marquer visitée.';
    END IF;
    IF NEW.visit_lat IS NULL OR NEW.visit_lon IS NULL OR NEW.visit_accuracy IS NULL OR NEW.visit_at IS NULL THEN
      RAISE EXCEPTION 'Position GPS requise (visit_lat, visit_lon, visit_accuracy, visit_at) pour marquer ce point visité.';
    END IF;
    IF NEW.visit_at < now() - max_fix_age OR NEW.visit_at > now() + max_fix_skew THEN
      RAISE EXCEPTION 'Position GPS trop ancienne ou horodatage invalide (max % dans le passé, % dans le futur).', max_fix_age, max_fix_skew;
    END IF;
    -- Distance calculée sur les coordonnées STOCKÉES du point (NEW.lat/lon
    -- égales à OLD.lat/lon grâce à la règle d'immutabilité ci-dessus).
    PERFORM public.check_visit_distance(NEW.lat, NEW.lon, NEW.visit_lat, NEW.visit_lon);
  ELSE
    -- Hors passage à visité : la preuve de position ne peut pas être
    -- réécrite (ni forgée a posteriori), on conserve l'ancienne valeur.
    NEW.visit_lat := OLD.visit_lat;
    NEW.visit_lon := OLD.visit_lon;
    NEW.visit_accuracy := OLD.visit_accuracy;
    NEW.visit_at := OLD.visit_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_visit_geofence() FROM PUBLIC;

DROP TRIGGER IF EXISTS census_points_enforce_geofence ON public.census_points;
CREATE TRIGGER census_points_enforce_geofence
  BEFORE INSERT OR UPDATE ON public.census_points
  FOR EACH ROW EXECUTE FUNCTION public.enforce_visit_geofence();

-- -------------------------------------------------------------
-- 4. Positions des agents terrain (suivi admin)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_positions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  accuracy   DOUBLE PRECISION,
  heading    DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- email : donnée personnelle dupliquée (déjà dans auth.users, exposée aux
-- admins via admin_list_accounts()). Rendue facultative pour que le client
-- puisse cesser de l'envoyer ; la colonne n'est PAS supprimée tant que le
-- client la lit encore (agentTracking.js : select user_id,email,...).
ALTER TABLE public.agent_positions ALTER COLUMN email DROP NOT NULL;

-- L'ancien idx_agent_positions_user_id était redondant avec l'index UNIQUE.
DROP INDEX IF EXISTS public.idx_agent_positions_user_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_positions_user_unique ON public.agent_positions (user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_positions'::regclass AND conname = 'agent_positions_lat_range') THEN
    ALTER TABLE public.agent_positions ADD CONSTRAINT agent_positions_lat_range
      CHECK (lat BETWEEN -90 AND 90) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_positions'::regclass AND conname = 'agent_positions_lon_range') THEN
    ALTER TABLE public.agent_positions ADD CONSTRAINT agent_positions_lon_range
      CHECK (lon BETWEEN -180 AND 180) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.agent_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can upsert own position" ON public.agent_positions;
DROP POLICY IF EXISTS "Authenticated can read agent positions" ON public.agent_positions;
DROP POLICY IF EXISTS "Admin can read all agent positions" ON public.agent_positions;

-- Un compte en attente ne publie pas de position.
CREATE POLICY "Agents can upsert own position"
  ON public.agent_positions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_approved_user()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_approved_user()));

-- Lecture globale : admin uniquement (un agent ne voit pas la position
-- temps réel des autres).
CREATE POLICY "Admin can read all agent positions"
  ON public.agent_positions FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- -------------------------------------------------------------
-- 5. Zones cibles (objectifs de couverture ajoutés par l'admin)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.target_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_target_zones_added_by ON public.target_zones (added_by);

ALTER TABLE public.target_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read target zones" ON public.target_zones;
DROP POLICY IF EXISTS "Authenticated can add target zones" ON public.target_zones;
DROP POLICY IF EXISTS "Authenticated can remove target zones" ON public.target_zones;
DROP POLICY IF EXISTS "Admin can manage target zones" ON public.target_zones;

CREATE POLICY "Authenticated can read target zones"
  ON public.target_zones FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

CREATE POLICY "Admin can manage target zones"
  ON public.target_zones FOR ALL TO authenticated
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

-- -------------------------------------------------------------
-- 6. Journal d'audit (alimenté par triggers SECURITY DEFINER, jamais par
--    le client)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON public.audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON public.audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON public.audit_events (user_id);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read audit events" ON public.audit_events;
CREATE POLICY "Admin can read audit events"
  ON public.audit_events FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

CREATE OR REPLACE FUNCTION public.audit_census_point_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, metadata)
  VALUES ((SELECT auth.uid()), lower(TG_OP), 'census_point', COALESCE(NEW.point_id, OLD.point_id),
    jsonb_build_object('visited', COALESCE(NEW.visited, OLD.visited), 'status', COALESCE(NEW.status, OLD.status)));
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.audit_census_point_changes() FROM PUBLIC;
DROP TRIGGER IF EXISTS census_points_audit_trigger ON public.census_points;
CREATE TRIGGER census_points_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.census_points
  FOR EACH ROW EXECUTE FUNCTION public.audit_census_point_changes();

-- -------------------------------------------------------------
-- 7. Privilèges de table : défense en profondeur (RLS reste la barrière
--    principale). anon n'a besoin d'AUCUNE table ; authenticated n'a que ce
--    que les policies autorisent.
-- -------------------------------------------------------------
REVOKE ALL ON public.census_points, public.agent_positions, public.target_zones,
              public.audit_events, public.user_roles FROM anon;
-- audit_events : lecture admin seulement, jamais d'écriture client.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated;
-- user_roles : le client ne fait que lire et changer role (roleManager.js).
REVOKE INSERT, DELETE, TRUNCATE ON public.user_roles FROM authenticated;
REVOKE UPDATE ON public.user_roles FROM authenticated;
GRANT UPDATE (role) ON public.user_roles TO authenticated;
