-- =============================================================
-- AJOUT : signalement de dangers terrain ("Route bloquée", "Inondation")
-- partagés entre TOUS les agents : contrairement aux fiches de recensement,
-- un danger doit être visible par n'importe quel agent approuvé, y compris
-- celui qui ne l'a pas signalé (information de sécurité collective).
-- À exécuter après schema.sql.
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.hazard_markers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  hazard_type  TEXT NOT NULL CHECK (hazard_type IN ('flooding', 'road_blocked', 'other')),
  note         TEXT,
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon          DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- created_by : ON DELETE CASCADE supprimait les signalements de sécurité
-- d'un agent (et donc l'alerte pour les autres) à la suppression de son
-- compte. Désormais SET NULL, colonne nullable : le danger reste visible.
ALTER TABLE public.hazard_markers ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.hazard_markers DROP CONSTRAINT IF EXISTS hazard_markers_created_by_fkey;
ALTER TABLE public.hazard_markers ADD CONSTRAINT hazard_markers_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index sur les clés étrangères (suppression d'un compte = scan sinon).
CREATE INDEX IF NOT EXISTS idx_hazard_markers_active ON public.hazard_markers (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hazard_markers_created_by ON public.hazard_markers (created_by);
CREATE INDEX IF NOT EXISTS idx_hazard_markers_resolved_by ON public.hazard_markers (resolved_by);

ALTER TABLE public.hazard_markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can report hazards" ON public.hazard_markers;
DROP POLICY IF EXISTS "Approved users can read all hazards" ON public.hazard_markers;
DROP POLICY IF EXISTS "Approved users can resolve hazards" ON public.hazard_markers;

-- Signalement : agent/admin approuvé, jamais au nom d'un autre.
CREATE POLICY "Approved users can report hazards"
  ON public.hazard_markers FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND (SELECT public.is_approved_user()));

-- Lecture : TOUS les utilisateurs approuvés voient TOUS les dangers
-- (sécurité collective, volontairement plus large que les fiches).
CREATE POLICY "Approved users can read all hazards"
  ON public.hazard_markers FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

-- Résolution : l'auteur ou un admin ; pas de DELETE (historique conservé).
CREATE POLICY "Approved users can resolve hazards"
  ON public.hazard_markers FOR UPDATE TO authenticated
  USING ((SELECT public.is_approved_user()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin_user())))
  WITH CHECK ((SELECT public.is_approved_user()) AND (created_by = (SELECT auth.uid()) OR (SELECT public.is_admin_user())));

REVOKE ALL ON public.hazard_markers FROM anon;
REVOKE DELETE, TRUNCATE ON public.hazard_markers FROM authenticated;

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'hazard_markers';
