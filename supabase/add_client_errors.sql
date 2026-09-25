-- ============================================================================
-- Suivi des erreurs JavaScript terrain (src/core/errorReporter.js)
-- ============================================================================
-- Idempotent. À exécuter dans : Dashboard Supabase → SQL Editor.
-- Puis activer côté app : variable GitHub Actions VITE_ENABLE_ERROR_REPORTING=true
-- (Settings → Secrets and variables → Actions → Variables) et redéployer.
--
-- Accès :
--   • INSERT : comptes connectés uniquement, toujours en leur propre nom
--     (user_id forcé à auth.uid() par défaut + vérifié par la policy).
--   • SELECT / DELETE : administrateurs uniquement.
--   • anon : aucun accès.
-- Les messages sont nettoyés côté client (e-mails / téléphones masqués).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL CHECK (char_length(fingerprint) <= 32),
  message      TEXT NOT NULL CHECK (char_length(message) <= 500),
  stack        TEXT CHECK (char_length(stack) <= 4000),
  source       TEXT CHECK (char_length(source) <= 60),
  page         TEXT CHECK (char_length(page) <= 300),
  app_version  TEXT CHECK (char_length(app_version) <= 40),
  user_agent   TEXT CHECK (char_length(user_agent) <= 300),
  online       BOOLEAN,
  occurrences  INTEGER NOT NULL DEFAULT 1 CHECK (occurrences BETWEEN 1 AND 100000),
  first_seen   TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_errors_received_idx ON public.client_errors (received_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_fingerprint_idx ON public.client_errors (fingerprint);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_errors FROM anon;
GRANT INSERT, SELECT, DELETE ON public.client_errors TO authenticated;

DROP POLICY IF EXISTS "Users insert own errors" ON public.client_errors;
CREATE POLICY "Users insert own errors"
  ON public.client_errors FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read errors" ON public.client_errors;
CREATE POLICY "Admins read errors"
  ON public.client_errors FOR SELECT TO authenticated
  USING (is_admin_user());

DROP POLICY IF EXISTS "Admins delete errors" ON public.client_errors;
CREATE POLICY "Admins delete errors"
  ON public.client_errors FOR DELETE TO authenticated
  USING (is_admin_user());

-- Vue de synthèse pour l'admin : une ligne par erreur distincte.
-- security_invoker => la RLS ci-dessus s'applique (admins seulement).
CREATE OR REPLACE VIEW public.client_errors_summary
WITH (security_invoker = true) AS
SELECT fingerprint,
       max(message)              AS message,
       sum(occurrences)::BIGINT  AS total,
       count(DISTINCT user_id)   AS agents_touches,
       max(app_version)          AS derniere_version,
       min(received_at)          AS premiere_fois,
       max(received_at)          AS derniere_fois
FROM public.client_errors
GROUP BY fingerprint;

REVOKE ALL ON public.client_errors_summary FROM anon;
GRANT SELECT ON public.client_errors_summary TO authenticated;

-- Rétention : purge des erreurs de plus de 90 jours (à lancer à la main
-- ou via pg_cron si activé) :
--   DELETE FROM public.client_errors WHERE received_at < now() - interval '90 days';
