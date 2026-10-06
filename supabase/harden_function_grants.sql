-- ============================================================================
-- Durcissement des droits EXECUTE (conseiller sécurité Supabase)
-- ============================================================================
-- À exécuter EN DERNIER (après schema.sql et tous les add_*.sql).
--
-- Pourquoi : les scripts font REVOKE ALL ON FUNCTION ... FROM PUBLIC, mais
-- Supabase accorde AUSSI EXECUTE directement au rôle "anon" via ses
-- privilèges par défaut : le REVOKE FROM PUBLIC ne retire donc pas ce droit,
-- et les fonctions SECURITY DEFINER restent appelables sans compte via
-- /rest/v1/rpc/NOM. Chaque fonction vérifie elle-même auth.uid() (NULL pour
-- anon), le risque est faible, mais on ferme la porte (défense en
-- profondeur, alertes 0028 du linter).
--
-- VERSION CONDITIONNELLE : chaque fonction est résolue via to_regprocedure()
-- ; une fonction absente (script add_*.sql pas encore exécuté, extension
-- PostGIS absente...) est ignorée avec un NOTICE au lieu de faire échouer
-- tout le script. Relancer ce script après avoir exécuté un script manquant.
--
-- Idempotent : peut être relancé sans effet de bord.
-- ============================================================================

DO $$
DECLARE
  -- Fonctions appelées par le client (RPC) ou par les policies RLS :
  -- retirées à anon/PUBLIC, accordées à authenticated. Le GRANT à
  -- authenticated est INDISPENSABLE pour is_admin_user() / is_approved_user() :
  -- toutes les policies (TO authenticated) les appellent.
  client_fns CONSTANT TEXT[] := ARRAY[
    'public.admin_list_accounts()',
    'public.is_admin_user()',
    'public.is_approved_user()',
    'public.redeem_invite(text)',
    'public.assert_visit_geofence(text,double precision,double precision)',
    'public.check_visit_distance(double precision,double precision,double precision,double precision)',
    'public.haversine_m(double precision,double precision,double precision,double precision)',
    'public.census_points_in_bbox(double precision,double precision,double precision,double precision,integer)'
  ];
  -- Fonctions de TRIGGER : jamais appelées par un client. Un trigger
  -- s'exécute sans que l'appelant ait besoin d'EXECUTE.
  trigger_fns CONSTANT TEXT[] := ARRAY[
    'public.handle_new_user_role()',
    'public.audit_census_point_changes()',
    'public.enforce_visit_geofence()',
    'public.set_updated_at()'
  ];
  sig TEXT;
  fn REGPROCEDURE;
BEGIN
  FOREACH sig IN ARRAY client_fns LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE 'Fonction absente, ignorée : %', sig;
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;

  FOREACH sig IN ARRAY trigger_fns LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE 'Fonction absente, ignorée : %', sig;
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, PUBLIC', fn);
    END IF;
  END LOOP;
END $$;

-- Les fonctions créées PLUS TARD dans le schéma public ne doivent plus être
-- exécutables par anon par défaut. (Vaut pour les objets créés par le rôle
-- qui exécute ce script, normalement postgres dans le SQL Editor.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Vérification : anon_peut_executer doit être FALSE partout ;
-- authenticated_peut_executer TRUE pour les fonctions client, FALSE pour
-- les fonctions de trigger.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_peut_executer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_peut_executer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_list_accounts','is_admin_user','is_approved_user','redeem_invite',
                    'assert_visit_geofence','check_visit_distance','haversine_m',
                    'census_points_in_bbox','handle_new_user_role',
                    'audit_census_point_changes','enforce_visit_geofence','set_updated_at')
ORDER BY 1;

-- Non traité ici, volontairement :
--  * postgis dans "public" : déplacer l'extension casserait
--    census_points_in_bbox (RLS sur spatial_ref_sys : voir add_spatial_bbox.sql).
--  * sheets_sync_state sans policy : voulu, seule la fonction Edge
--    sheets-sync (service_role) y accède (add_sheets_sync.sql).
--  * Protection contre les mots de passe compromis : à activer dans
--    Dashboard, Authentication, paramètres des mots de passe.
