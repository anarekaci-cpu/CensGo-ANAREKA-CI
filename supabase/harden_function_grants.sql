-- ============================================================================
-- Durcissement des droits EXECUTE (conseiller sécurité Supabase, 25/09/2026)
-- ============================================================================
-- Pourquoi : les scripts reset_rls.sql / add_invites.sql font
--   REVOKE ALL ON FUNCTION … FROM PUBLIC;
-- mais Supabase accorde AUSSI EXECUTE directement au rôle "anon" via ses
-- privilèges par défaut. Le REVOKE FROM PUBLIC ne retire donc pas ce droit :
-- ces fonctions SECURITY DEFINER restent appelables sans compte via
-- /rest/v1/rpc/<nom>.
--
-- Risque actuel : faible — chaque fonction vérifie elle-même auth.uid()
-- (NULL pour anon → 0 ligne / refus). Ce script ferme quand même la porte
-- (défense en profondeur) et règle les alertes 0028 du linter.
--
-- Idempotent : peut être relancé sans effet de bord.
-- À exécuter dans : Dashboard Supabase → SQL Editor.
-- ============================================================================

-- 1) Fonctions applicatives : jamais pour anon, seulement pour authenticated.
--    anon hérite aussi de PUBLIC : il faut retirer les DEUX, puis redonner
--    explicitement le droit à authenticated — INDISPENSABLE, toutes les
--    policies RLS (TO authenticated) appellent is_approved_user() /
--    is_admin_user() : sans ce GRANT, les agents ne verraient plus rien.
REVOKE EXECUTE ON FUNCTION public.admin_list_accounts() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_user()       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approved_user()    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_invite(TEXT)   FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_accounts() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin_user()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_approved_user()    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_invite(TEXT)   TO authenticated;

-- 2) Fonction de trigger : appelée uniquement par le trigger
--    on_auth_user_created (qui s'exécute avec les droits du propriétaire).
--    Aucun client n'a besoin de l'appeler en RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM anon, authenticated, PUBLIC;

-- 3) search_path figé sur le trigger updated_at (alerte 0011).
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- Vérification : anon_peut_executer doit être FALSE partout,
-- authenticated_peut_executer TRUE (sauf handle_new_user_role : FALSE).
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_peut_executer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_peut_executer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_list_accounts','is_admin_user','is_approved_user','redeem_invite','handle_new_user_role')
ORDER BY 1;

-- Non traité ici, volontairement :
--  • spatial_ref_sys sans RLS / postgis dans "public" : table de référence
--    PostGIS (systèmes de coordonnées, aucune donnée ANAREKA). Déplacer
--    l'extension casserait census_points_in_bbox — risque accepté.
--  • sheets_sync_state sans policy : voulu, seule la fonction Edge
--    sheets-sync (service_role) y accède.
--  • Protection contre les mots de passe compromis : à activer dans
--    Dashboard → Authentication → (paramètres des mots de passe).
