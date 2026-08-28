-- =============================================================
-- AJOUT : journal des tournées optimisées terminées, pour approximer les
-- kilomètres parcourus par agent dans le rapport de paie (voir
-- src/modules/report/agentReport.js).
-- À exécuter dans le SQL Editor du dashboard Supabase, après schema.sql.
--
-- Limite assumée : ceci mesure la distance des tournées lancées via la
-- fonction "Tournée optimisée", pas tout déplacement terrain (un agent qui
-- travaille sans lancer de tournée n'ajoute aucune distance). C'est une
-- approximation choisie sciemment plutôt qu'un vrai suivi GPS historique
-- (qui demanderait une nouvelle politique de rétention/vie privée).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS tour_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  stop_count  INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tour_sessions_user_id ON tour_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_tour_sessions_started_at ON tour_sessions (started_at);

ALTER TABLE tour_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can log own tour sessions" ON tour_sessions;
DROP POLICY IF EXISTS "Users can read own tour sessions" ON tour_sessions;
DROP POLICY IF EXISTS "Admin can read all tour sessions" ON tour_sessions;

-- Écriture : chaque agent ne peut journaliser QUE ses propres tournées
-- (append-only — pas de policy UPDATE/DELETE, comme audit_events).
CREATE POLICY "Agents can log own tour sessions"
  ON tour_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_approved_user());

-- Lecture : un agent voit son propre historique ; l'admin voit tout
-- (rapport de paie, voir panneau "Comptes agents").
CREATE POLICY "Users can read own tour sessions"
  ON tour_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin can read all tour sessions"
  ON tour_sessions FOR SELECT TO authenticated
  USING (is_admin_user());

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tour_sessions';
