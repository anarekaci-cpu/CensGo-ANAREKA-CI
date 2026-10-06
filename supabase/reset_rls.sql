-- =============================================================
-- reset_rls.sql : REMPLACÉ PAR schema.sql (script volontairement vide)
--
-- Ce fichier était une seconde copie de schema.sql avec des divergences
-- (colonnes created_at/zone absentes, policies EXISTS redondantes, pas de
-- trigger géofence ni updated_at). Deux sources de vérité pour la sécurité
-- = risque de réintroduire des policies plus faibles par erreur.
--
-- Pour réinitialiser les tables et REMPLACER toutes les policies RLS :
-- exécuter supabase/schema.sql (idempotent, ne supprime aucune donnée,
-- fonctionne sur une base vierge comme sur une base existante).
--
-- ORDRE D'EXÉCUTION COMPLET :
--   1. schema.sql
--   2. add_cities.sql, add_census_photos.sql, add_invites.sql,
--      add_tour_sessions.sql, add_hazard_markers.sql, add_sheets_sync.sql,
--      add_spatial_bbox.sql (ordre indifférent entre eux)
--   3. harden_function_grants.sql (en dernier)
--   Dépannage lecture : fix_read_access.sql (uniquement si des agents
--   DÉJÀ validés ne voient plus aucun point).
-- =============================================================
DO $$
BEGIN
  RAISE NOTICE 'reset_rls.sql ne fait plus rien : exécuter supabase/schema.sql (voir en-tête).';
END $$;
