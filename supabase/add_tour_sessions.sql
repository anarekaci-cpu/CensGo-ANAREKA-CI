-- =============================================================
-- AJOUT : journal des tournées optimisées terminées, pour approximer les
-- kilomètres parcourus par agent dans le rapport de paie (voir
-- src/modules/report/agentReport.js).
-- À exécuter après schema.sql (dépend de is_approved_user()/is_admin_user()).
--
-- Limite assumée : ceci mesure la distance des tournées lancées via la
-- fonction "Tournée optimisée", pas tout déplacement terrain. C'est une
-- approximation choisie sciemment plutôt qu'un vrai suivi GPS historique
-- (qui demanderait une nouvelle politique de rétention/vie privée).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.tour_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  stop_count  INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_id : l'ancien ON DELETE CASCADE effaçait TOUT l'historique de paie
-- (distances parcourues) d'un agent dès la suppression de son compte auth.
-- Choix : ON DELETE SET NULL (nullable) plutôt que RESTRICT.
--   * RESTRICT bloquerait la suppression du compte (et donc un effacement
--     RGPD légitime) tant que des tournées existent ;
--   * SET NULL anonymise la ligne mais conserve les kilomètres/dates pour la
--     comptabilité, comme census_points.created_by et audit_events.user_id.
-- Les lignes orphelines (user_id NULL) ne sont lisibles que par un admin.
ALTER TABLE public.tour_sessions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.tour_sessions DROP CONSTRAINT IF EXISTS tour_sessions_user_id_fkey;
ALTER TABLE public.tour_sessions ADD CONSTRAINT tour_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index : (user_id, started_at) sert le rapport par agent et par période et
-- remplace l'ancien index seul sur user_id (redondant, préfixe du composite).
DROP INDEX IF EXISTS public.idx_tour_sessions_user_id;
CREATE INDEX IF NOT EXISTS idx_tour_sessions_user_started ON public.tour_sessions (user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_tour_sessions_started_at ON public.tour_sessions (started_at);

-- Garde-fous anti-fraude paie, NOT VALID : appliqués aux NOUVELLES lignes
-- sans bloquer sur l'historique. Après vérification qu'aucune ligne
-- existante ne les viole, valider avec :
--   ALTER TABLE public.tour_sessions VALIDATE CONSTRAINT nom_de_la_contrainte;
-- (tour_sessions_distance_km_range, tour_sessions_stop_count_nonneg,
--  tour_sessions_period_check)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tour_sessions'::regclass AND conname = 'tour_sessions_distance_km_range') THEN
    ALTER TABLE public.tour_sessions ADD CONSTRAINT tour_sessions_distance_km_range
      CHECK (distance_km >= 0 AND distance_km <= 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tour_sessions'::regclass AND conname = 'tour_sessions_stop_count_nonneg') THEN
    ALTER TABLE public.tour_sessions ADD CONSTRAINT tour_sessions_stop_count_nonneg
      CHECK (stop_count >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tour_sessions'::regclass AND conname = 'tour_sessions_period_check') THEN
    ALTER TABLE public.tour_sessions ADD CONSTRAINT tour_sessions_period_check
      CHECK (ended_at >= started_at AND ended_at - started_at <= INTERVAL '24 hours') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.tour_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can log own tour sessions" ON public.tour_sessions;
DROP POLICY IF EXISTS "Users can read own tour sessions" ON public.tour_sessions;
DROP POLICY IF EXISTS "Admin can read all tour sessions" ON public.tour_sessions;

-- Écriture : chaque agent ne journalise QUE ses propres tournées
-- (append-only : pas de policy UPDATE/DELETE, comme audit_events).
CREATE POLICY "Agents can log own tour sessions"
  ON public.tour_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_approved_user()));

-- Lecture : un agent voit son historique ; l'admin voit tout (rapport de paie).
CREATE POLICY "Users can read own tour sessions"
  ON public.tour_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admin can read all tour sessions"
  ON public.tour_sessions FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- Défense en profondeur : le journal est append-only, anon n'y accède pas.
REVOKE ALL ON public.tour_sessions FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.tour_sessions FROM authenticated;

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tour_sessions';
