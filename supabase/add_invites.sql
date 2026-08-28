-- =============================================================
-- AJOUT : inscription par lien d'invitation admin.
-- À exécuter dans le SQL Editor du dashboard Supabase, après schema.sql.
--
-- Contexte : approuver chaque nouvel agent un par un (panneau "Comptes
-- agents") devient pénible en recrutant sur plusieurs villes à la fois. Un
-- admin génère ici un lien réutilisable (compteur d'usages + expiration
-- optionnelle) ; un agent qui s'inscrit via ce lien est approuvé
-- AUTOMATIQUEMENT, sans passer par l'état "en attente".
--
-- Sécurité :
--  - Les invitations ne peuvent créer QUE le rôle 'agent' (jamais 'admin')
--    — un lien qui fuite (capture d'écran, transfert WhatsApp à la mauvaise
--    personne) ne peut donc jamais servir à s'auto-promouvoir admin ; la
--    promotion admin reste un geste manuel humain (panneau agents existant).
--  - redeem_invite() ne touche QUE la ligne user_roles de l'appelant
--    (auth.uid()) et UNIQUEMENT si son rôle est encore NULL — impossible de
--    rejouer un lien pour changer le rôle d'un compte déjà validé.
--  - "SELECT ... FOR UPDATE" verrouille la ligne d'invitation pendant la
--    transaction : deux inscriptions simultanées sur un lien à 1 usage
--    restant ne peuvent pas toutes les deux réussir (même classe de bug que
--    les races déjà corrigées ailleurs dans ce projet, voir syncEngine.js).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role = 'agent'),
  max_uses   INTEGER, -- NULL = illimité
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ, -- NULL = jamais
  revoked    BOOLEAN NOT NULL DEFAULT false,
  label      TEXT, -- ex: "Recrutement Cocody août 2026" — usage admin uniquement
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage invites" ON invites;
CREATE POLICY "Admin can manage invites"
  ON invites FOR ALL TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- redeem_invite() doit être appelable par un compte fraîchement inscrit
-- (role NULL, donc bloqué par la policy ci-dessus) : SECURITY DEFINER
-- contourne RLS pour la durée de la fonction, comme is_approved_user() et
-- handle_new_user_role() dans schema.sql.
CREATE OR REPLACE FUNCTION redeem_invite(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  granted_role TEXT;
BEGIN
  SELECT * INTO inv FROM invites WHERE token = p_token FOR UPDATE;

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

  UPDATE invites SET uses = uses + 1 WHERE id = inv.id;

  -- "AND role IS NULL" : n'agit QUE sur un compte encore en attente. Un
  -- compte déjà agent/admin qui rejoue un lien ne voit RIEN changer.
  UPDATE user_roles SET role = inv.role WHERE user_id = auth.uid() AND role IS NULL
  RETURNING role INTO granted_role;

  IF granted_role IS NULL THEN
    RAISE EXCEPTION 'Ce compte est déjà validé — invitation sans effet.';
  END IF;

  RETURN granted_role;
END;
$$;

REVOKE ALL ON FUNCTION redeem_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_invite(TEXT) TO authenticated;

-- Vérification post-application
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'invites';
