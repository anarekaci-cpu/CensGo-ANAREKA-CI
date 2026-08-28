-- =============================================================
-- AJOUT : villes multi-sites gérées par l'admin.
-- À exécuter dans le SQL Editor du dashboard Supabase, après schema.sql.
--
-- Contexte : le recensement s'étend au-delà de Bingerville (Cocody,
-- Grand-Bassam, etc.). "city" doit rester une liste FERMÉE gérée par
-- l'admin uniquement — contrairement à "quartier" (texte libre saisi par
-- l'agent) — pour éviter les variantes d'orthographe ("Cocody" / "cocody" /
-- "Cocody ") qui fragmenteraient les statistiques et les filtres par ville.
-- Même pattern que target_zones (voir schema.sql).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- Ne supprime ni ne modifie aucune donnée existante (hors backfill "city"
-- ci-dessous, qui ne touche que les lignes actuellement vides).
-- =============================================================

CREATE TABLE IF NOT EXISTS cities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read cities" ON cities;
DROP POLICY IF EXISTS "Admin can manage cities" ON cities;

-- Lecture : tout compte approuvé (nécessaire pour peupler le menu
-- déroulant "Ville" du formulaire de recensement).
CREATE POLICY "Authenticated can read cities"
  ON cities FOR SELECT TO authenticated
  USING (is_approved_user());

-- Écriture/suppression : admin uniquement. is_admin_user() est défini dans
-- schema.sql — ce script doit être exécuté APRÈS schema.sql.
CREATE POLICY "Admin can manage cities"
  ON cities FOR ALL TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Données déjà recensées : toutes à Bingerville jusqu'ici.
INSERT INTO cities (name) VALUES ('Bingerville') ON CONFLICT (name) DO NOTHING;

-- Colonne "city" sur census_points, ajoutée sans toucher aux lignes déjà
-- présentes (même pattern que "quartier"/"zone" dans schema.sql).
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
UPDATE census_points SET city = 'Bingerville' WHERE city = '';

CREATE INDEX IF NOT EXISTS idx_census_points_city ON census_points (city);

-- Vérification post-application (résultat attendu : au moins la ligne
-- 'Bingerville', et policyname listant les deux policies ci-dessus)
SELECT * FROM cities ORDER BY name;
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'cities';
