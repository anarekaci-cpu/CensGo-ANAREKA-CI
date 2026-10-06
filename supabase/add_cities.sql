-- =============================================================
-- AJOUT : villes multi-sites gérées par l'admin.
-- À exécuter après schema.sql (dépend de is_approved_user()/is_admin_user()).
--
-- Contexte : le recensement s'étend au-delà de Bingerville. "city" doit
-- rester une liste FERMÉE gérée par l'admin uniquement (contrairement à
-- "quartier", texte libre saisi par l'agent) pour éviter les variantes
-- d'orthographe qui fragmenteraient statistiques et filtres. Même pattern
-- que target_zones (voir schema.sql).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur. Le backfill
-- "Bingerville" n'a lieu QU'UNE FOIS, à la création de la colonne city :
-- une réexécution ultérieure ne réattribue jamais à Bingerville des fiches
-- dont la ville serait volontairement vide.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cities_added_by ON public.cities (added_by);

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read cities" ON public.cities;
DROP POLICY IF EXISTS "Admin can manage cities" ON public.cities;

-- Lecture : tout compte approuvé (menu déroulant "Ville" du formulaire).
CREATE POLICY "Authenticated can read cities"
  ON public.cities FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

-- Écriture/suppression : admin uniquement.
CREATE POLICY "Admin can manage cities"
  ON public.cities FOR ALL TO authenticated
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

REVOKE ALL ON public.cities FROM anon;

INSERT INTO public.cities (name) VALUES ('Bingerville') ON CONFLICT (name) DO NOTHING;

-- Colonne "city" + backfill NON REJOUABLE : exécuté seulement si la colonne
-- n'existe pas encore (toutes les fiches existantes étaient à Bingerville).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'census_points' AND column_name = 'city'
  ) THEN
    ALTER TABLE public.census_points ADD COLUMN city TEXT NOT NULL DEFAULT '';
    UPDATE public.census_points SET city = 'Bingerville' WHERE city = '';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_census_points_city ON public.census_points (city);

-- Vérification post-application
SELECT * FROM public.cities ORDER BY name;
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'cities';
