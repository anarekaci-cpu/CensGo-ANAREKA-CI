-- =============================================================
-- FIX URGENT : restaure la lecture des points pour les agents
-- connectés. À exécuter dans le SQL Editor du dashboard Supabase
-- (projet dojbdzponyioicetgziw).
--
-- Symptôme : 505 lignes visibles dans le dashboard (service_role,
-- bypass RLS) mais l'API REST renvoie 0 ligne aux agents connectés.
-- Cause : policy SELECT absente ou trop restrictive sur le serveur
--         (ex: USING (created_by = auth.uid()) alors que les points
--         importés ont created_by = NULL).
--
-- Idempotent : peut être exécuté plusieurs fois sans risque.
-- Ne modifie AUCUNE donnée, ne désactive PAS RLS.
-- =============================================================

-- 0. Diagnostic (optionnel) : voir les policies actuellement actives
--    Exécuter d'abord ceci et conserver le résultat pour audit :
--
--    SELECT policyname, roles, cmd, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'census_points';

-- 1. S'assurer que RLS est bien ACTIVÉ (sécurité — ne pas désactiver)
ALTER TABLE census_points ENABLE ROW LEVEL SECURITY;

-- 2. Supprimer toute policy SELECT existante quel que soit son nom
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'census_points'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON census_points', pol.policyname);
    RAISE NOTICE 'Policy SELECT supprimée : %', pol.policyname;
  END LOOP;
END $$;

-- 3. Recréer la policy de lecture conforme au schéma de référence :
--    tout agent AUTHENTIFIÉ lit tous les points (carte partagée entre
--    agents). Les anonymes restent bloqués (aucune policy anon).
CREATE POLICY "Authenticated read access"
  ON census_points FOR SELECT
  TO authenticated
  USING (true);

-- 4. Vérification post-application (à exécuter, résultat attendu :
--    policyname = 'Authenticated read access', roles = {authenticated})
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'census_points';
