-- =============================================================
-- Quota IA par utilisateur et par jour (Edge Function ai-agent).
-- À exécuter dans Supabase > SQL Editor APRÈS schema.sql. Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ai usage" ON ai_usage;
-- Lecture seule de son propre compteur ; AUCUNE policy d'écriture : seules
-- les fonctions SECURITY DEFINER ci-dessous modifient la table.
CREATE POLICY "Users read own ai usage"
  ON ai_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON ai_usage FROM anon, authenticated;
GRANT SELECT ON ai_usage TO authenticated;

-- Incrément atomique (un seul UPSERT conditionnel, pas de lecture puis
-- écriture) : renvoie allowed=false sans incrémenter si la limite du jour
-- est déjà atteinte. L'identité vient de auth.uid(), jamais d'un paramètre.
CREATE OR REPLACE FUNCTION increment_ai_usage(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (allowed BOOLEAN, used INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    p_limit := 50;
  END IF;

  INSERT INTO ai_usage AS u (user_id, day, count)
  VALUES (v_uid, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (user_id, day) DO UPDATE
    SET count = u.count + 1
    WHERE u.count < p_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NULL THEN
    -- Conflit sans mise à jour : limite atteinte.
    SELECT u.count INTO v_count FROM ai_usage u
      WHERE u.user_id = v_uid AND u.day = (now() AT TIME ZONE 'utc')::date;
    RETURN QUERY SELECT FALSE, COALESCE(v_count, p_limit);
  ELSE
    RETURN QUERY SELECT TRUE, v_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION increment_ai_usage(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION increment_ai_usage(INTEGER) TO authenticated;
