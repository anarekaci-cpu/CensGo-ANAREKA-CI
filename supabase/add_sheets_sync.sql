-- =============================================================
-- AJOUT : double envoi automatique vers Google Sheets (en plus de
-- Supabase, jamais à la place), un onglet par ville + un onglet "Général".
-- À exécuter après schema.sql.
--
-- Cette table sert UNIQUEMENT à la Edge Function "sheets-sync"
-- (supabase/functions/sheets-sync/index.ts), appelée avec la clé
-- service_role : jamais accessible depuis le client. RLS activé sans aucune
-- policy = accès refusé par défaut ; en plus, les privilèges de table sont
-- retirés à anon et authenticated (défense en profondeur : si une policy
-- était ajoutée par erreur, les GRANT ne l'ouvriraient pas). service_role
-- contourne RLS et garde ses privilèges.
--
-- Clé composite (point_id, sheet_name) : un même point occupe une ligne dans
-- DEUX onglets (sa ville + "Général"), donc deux lignes de correspondance.
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sheets_sync_state (
  point_id    TEXT NOT NULL REFERENCES public.census_points(point_id) ON DELETE CASCADE,
  sheet_name  TEXT NOT NULL,
  row_number  INTEGER NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (point_id, sheet_name)
);

ALTER TABLE public.sheets_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sheets_sync_state FROM anon, authenticated;

-- Vérification post-application (résultat attendu : 0 ligne, aucune policy)
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'sheets_sync_state';
