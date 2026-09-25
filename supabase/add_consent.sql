-- ============================================================================
-- Consentement des personnes recensées (loi n° 2013-450, ARTCI)
-- ============================================================================
-- Idempotent. À exécuter dans : Dashboard Supabase → SQL Editor.
-- Puis activer côté app : variable GitHub Actions VITE_ENABLE_CONSENT=true
-- (et, facultatif, VITE_CONSENT_CONTACT="07 00 00 00 00" = contact affiché
-- dans le texte lu à la personne), et redéployer.
--
-- Colonnes nullables : les fiches recensées AVANT l'activation n'ont pas de
-- consentement tracé (NULL) — elles restent valides, et la requête en bas
-- de fichier permet de les lister pour régularisation.
-- ============================================================================

ALTER TABLE public.census_points
  ADD COLUMN IF NOT EXISTS consent_given   BOOLEAN,
  ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_method  TEXT,
  ADD COLUMN IF NOT EXISTS consent_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consent_version TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'census_points_consent_method_chk') THEN
    ALTER TABLE public.census_points
      ADD CONSTRAINT census_points_consent_method_chk
      CHECK (consent_method IS NULL OR consent_method IN ('oral', 'ecrit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'census_points_consent_coherent_chk') THEN
    -- Un consentement marqué "donné" doit être daté.
    ALTER TABLE public.census_points
      ADD CONSTRAINT census_points_consent_coherent_chk
      CHECK (consent_given IS NOT TRUE OR consent_at IS NOT NULL);
  END IF;
END $$;

-- Les policies existantes de census_points (reset_rls.sql) couvrent déjà ces
-- colonnes : lecture/écriture réservées aux comptes approuvés.

-- Suivi : fiches sans consentement tracé (à régulariser lors d'un passage).
-- SELECT point_id, name, quartier, created_at
-- FROM public.census_points
-- WHERE consent_given IS NOT TRUE
-- ORDER BY created_at DESC;
