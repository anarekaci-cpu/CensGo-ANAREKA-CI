-- =============================================================
-- AJOUT : signalement de dangers terrain ("Route bloquée", "Inondation")
-- partagés entre TOUS les agents — contrairement aux fiches de recensement
-- (visibilité propriétaire/admin), un danger doit être visible par n'importe
-- quel agent approuvé, y compris celui qui ne l'a pas signalé : c'est une
-- information de sécurité collective, pas une donnée de recensement.
-- À exécuter dans le SQL Editor du dashboard Supabase, après schema.sql.
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS hazard_markers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hazard_type  TEXT NOT NULL CHECK (hazard_type IN ('flooding', 'road_blocked', 'other')),
  note         TEXT,
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon          DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_hazard_markers_active ON hazard_markers (resolved_at) WHERE resolved_at IS NULL;

ALTER TABLE hazard_markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can report hazards" ON hazard_markers;
DROP POLICY IF EXISTS "Approved users can read all hazards" ON hazard_markers;
DROP POLICY IF EXISTS "Approved users can resolve hazards" ON hazard_markers;

-- Écriture (signalement) : n'importe quel agent/admin approuvé, jamais au
-- nom d'un autre (created_by = auth.uid()).
CREATE POLICY "Approved users can report hazards"
  ON hazard_markers FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_approved_user());

-- Lecture : TOUS les utilisateurs approuvés voient TOUS les dangers actifs
-- ou passés — sécurité collective, volontairement plus large que le modèle
-- propriétaire des fiches de recensement (voir schema.sql).
CREATE POLICY "Approved users can read all hazards"
  ON hazard_markers FOR SELECT TO authenticated
  USING (is_approved_user());

-- Résolution : l'auteur du signalement ou un admin peut le marquer résolu —
-- pas de DELETE (historique conservé, comme audit_events/tour_sessions).
CREATE POLICY "Approved users can resolve hazards"
  ON hazard_markers FOR UPDATE TO authenticated
  USING (is_approved_user() AND (created_by = auth.uid() OR is_admin_user()))
  WITH CHECK (is_approved_user() AND (created_by = auth.uid() OR is_admin_user()));

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'hazard_markers';
