-- =============================================================
-- AJOUT : inscription par lien d'invitation admin.
-- À exécuter après schema.sql.
--
-- Contexte : approuver chaque nouvel agent un par un devient pénible en
-- recrutant sur plusieurs villes à la fois. Un admin génère ici un lien
-- réutilisable (compteur d'usages + expiration) ; un agent qui s'inscrit via
-- ce lien est approuvé AUTOMATIQUEMENT, sans passer par l'état "en attente".
--
-- Sécurité :
--  - Les invitations ne peuvent créer QUE le rôle 'agent' (jamais 'admin') :
--    un lien qui fuite ne peut pas servir à s'auto-promouvoir admin.
--  - redeem_invite() ne touche QUE la ligne user_roles de l'appelant et
--    UNIQUEMENT si son rôle est encore NULL.
--  - SELECT ... FOR UPDATE verrouille la ligne d'invitation : deux
--    inscriptions simultanées sur un lien à 1 usage restant ne peuvent pas
--    réussir toutes les deux.
--  - Plafonds par défaut : 20 usages maximum et 7 jours de validité. Un lien
--    "illimité" (max_uses NULL) ou "sans expiration" (expires_at NULL) n'est
--    plus possible : le trigger invites_apply_limits remplace NULL par ces
--    défauts (un lien oublié ne reste jamais valable indéfiniment).
--  - Chaque utilisation est journalisée dans audit_events (jamais le jeton).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role = 'agent'),
  max_uses   INTEGER DEFAULT 20,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  revoked    BOOLEAN NOT NULL DEFAULT false,
  label      TEXT, -- ex: "Recrutement Cocody août 2026" (usage admin uniquement)
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tables déjà existantes : nouveaux défauts (n'affecte pas les lignes
-- actuelles).
ALTER TABLE public.invites ALTER COLUMN max_uses SET DEFAULT 20;
ALTER TABLE public.invites ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS idx_invites_created_by ON public.invites (created_by);

-- Cohérence des compteurs (NOT VALID : n'examine que les nouvelles écritures ;
-- valider avec ALTER TABLE public.invites VALIDATE CONSTRAINT nom_contrainte
-- une fois les anciennes invitations contrôlées : invites_max_uses_range,
-- invites_uses_within_max).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invites'::regclass AND conname = 'invites_max_uses_range') THEN
    ALTER TABLE public.invites ADD CONSTRAINT invites_max_uses_range
      CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 20) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invites'::regclass AND conname = 'invites_uses_within_max') THEN
    ALTER TABLE public.invites ADD CONSTRAINT invites_uses_within_max
      CHECK (uses >= 0 AND (max_uses IS NULL OR uses <= max_uses)) NOT VALID;
  END IF;
END $$;

-- Remplace NULL par les plafonds par défaut à la création (le client envoie
-- explicitement NULL pour "illimité", ce que DEFAULT seul ne corrigerait pas).
CREATE OR REPLACE FUNCTION public.invites_apply_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.max_uses IS NULL THEN
    NEW.max_uses := 20;
  END IF;
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + INTERVAL '7 days';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.invites_apply_limits() FROM PUBLIC;

DROP TRIGGER IF EXISTS invites_apply_limits_trigger ON public.invites;
CREATE TRIGGER invites_apply_limits_trigger
  BEFORE INSERT ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.invites_apply_limits();

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage invites" ON public.invites;
CREATE POLICY "Admin can manage invites"
  ON public.invites FOR ALL TO authenticated
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

REVOKE ALL ON public.invites FROM anon;

-- redeem_invite() doit être appelable par un compte fraîchement inscrit
-- (role NULL, donc bloqué par la policy ci-dessus) : SECURITY DEFINER
-- contourne RLS pour la durée de la fonction.
CREATE OR REPLACE FUNCTION public.redeem_invite(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inv RECORD;
  granted_role TEXT;
  caller UUID := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.';
  END IF;

  SELECT * INTO inv FROM public.invites WHERE token = p_token FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation invalide.';
  END IF;
  IF inv.revoked THEN
    RAISE EXCEPTION 'Invitation révoquée.';
  END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at < now() THEN
    RAISE EXCEPTION 'Invitation expirée.';
  END IF;
  IF inv.max_uses IS NOT NULL AND inv.uses >= inv.max_uses THEN
    RAISE EXCEPTION 'Invitation déjà entièrement utilisée.';
  END IF;

  -- "AND role IS NULL" : n'agit QUE sur un compte encore en attente. Un
  -- compte déjà agent/admin qui rejoue un lien ne voit RIEN changer. Le
  -- compteur n'est incrémenté qu'APRÈS ce contrôle (voir plus bas), dans la
  -- même transaction : une exception annule tout.
  UPDATE public.user_roles SET role = inv.role WHERE user_id = caller AND role IS NULL
  RETURNING role INTO granted_role;

  IF granted_role IS NULL THEN
    RAISE EXCEPTION 'Ce compte est déjà validé — invitation sans effet.';
  END IF;

  UPDATE public.invites SET uses = uses + 1 WHERE id = inv.id;

  -- Traçabilité : qui a utilisé quelle invitation (identifiant, jamais le
  -- jeton, qui reste un secret).
  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, metadata)
  VALUES (caller, 'redeem_invite', 'invite', inv.id::text,
          jsonb_build_object('role', granted_role, 'uses_after', inv.uses + 1, 'max_uses', inv.max_uses));

  RETURN granted_role;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invite(TEXT) TO authenticated;

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'invites';
