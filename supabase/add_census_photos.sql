-- =============================================================
-- AJOUT : photo obligatoire à la création d'une fiche (preuve terrain que
-- l'endroit existe réellement, en complément du contrôle GPS anti-fraude
-- déjà en place pour "visité"). À exécuter dans le SQL Editor du dashboard
-- Supabase, après schema.sql.
--
-- Bucket PRIVÉ (pas public) : les photos peuvent montrer des devantures, des
-- personnes, des plaques d'adresse — cohérent avec la posture vie-privée
-- déjà documentée pour les autres données personnelles de ce projet. Accès
-- uniquement via URL signée à la demande (voir src/core/censusPhotos.js),
-- jamais d'URL publique permanente.
--
-- Chemin de stockage : {user_id}/{point_id}-{timestamp}.jpg — le premier
-- segment du chemin (storage.foldername(name)[1]) sert de propriétaire pour
-- les policies ci-dessous, même logique que le reste du projet
-- (created_by = auth.uid() sur census_points).
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('census-photos', 'census-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Agents can upload own census photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own census photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin can read all census photos" ON storage.objects;

-- Écriture : un agent approuvé ne peut écrire QUE dans son propre dossier
-- (premier segment du chemin = son user_id) — is_admin_user()/
-- is_approved_user() définies dans schema.sql, ce script doit donc être
-- exécuté APRÈS schema.sql.
CREATE POLICY "Agents can upload own census photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'census-photos'
    AND is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lecture : le propriétaire de la photo, ou un admin (rapport de paie /
-- vérification terrain).
CREATE POLICY "Users can read own census photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'census-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Admin can read all census photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'census-photos' AND is_admin_user());

-- Référence de la photo sur la fiche elle-même. Nullable : une fiche créée
-- avant ce correctif (ou dont la photo n'a pas encore fini de synchroniser)
-- n'a simplement pas de preuve associée.
ALTER TABLE census_points ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- Vérification post-application
SELECT id, public FROM storage.buckets WHERE id = 'census-photos';
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE '%census photos%';
