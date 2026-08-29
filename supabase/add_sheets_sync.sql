-- =============================================================
-- AJOUT : double envoi automatique vers Google Sheets (en plus de
-- Supabase, jamais à la place), un onglet par ville + un onglet "Général".
-- À exécuter dans le SQL Editor du dashboard Supabase, après schema.sql.
--
-- Cette table sert UNIQUEMENT à la Edge Function "sheets-sync"
-- (supabase/functions/sheets-sync/index.ts), appelée avec la clé
-- service_role — jamais accessible depuis le client (aucune policy pour
-- "authenticated"/"anon" ci-dessous = accès refusé par défaut ; service_role
-- contourne de toute façon RLS, comme partout ailleurs dans Supabase).
--
-- Clé composite (point_id, sheet_name) : un même point occupe une ligne dans
-- DEUX onglets (sa ville + "Général"), donc deux lignes de correspondance.
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS sheets_sync_state (
  point_id    TEXT NOT NULL REFERENCES census_points(point_id) ON DELETE CASCADE,
  sheet_name  TEXT NOT NULL,
  row_number  INTEGER NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (point_id, sheet_name)
);

ALTER TABLE sheets_sync_state ENABLE ROW LEVEL SECURITY;

-- Vérification post-application (résultat attendu : 0 ligne — RLS activé,
-- aucune policy pour authenticated/anon).
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'sheets_sync_state';
