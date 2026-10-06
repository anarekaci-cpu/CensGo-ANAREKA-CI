-- =============================================================
-- AJOUT : photo de preuve à la création d'une fiche (preuve terrain que
-- l'endroit existe réellement, en complément du contrôle GPS anti-fraude).
-- À exécuter après schema.sql.
--
-- Bucket PRIVÉ (pas public) : les photos peuvent montrer des devantures, des
-- personnes, des plaques d'adresse. Accès uniquement via URL signée à la
-- demande (voir src/core/censusPhotos.js), jamais d'URL publique.
--
-- Chemin de stockage : user_id/point_id-timestamp.jpg. Le premier segment
-- du chemin (storage.foldername(name)[1]) sert de propriétaire pour les
-- policies ci-dessous.
--
-- Limites imposées par le bucket lui-même (côté serveur, non contournables
-- par un client modifié) : 2 Mo par fichier, types jpeg/webp/png.
--
-- photo_path obligatoire pour un non-admin : NON IMPOSÉ en base, volontaire.
-- Le flux offline-first crée d'abord la fiche (synchro), puis envoie la
-- photo dans un second canal (syncEngine.js : uploadOnePhoto, UPDATE de
-- photo_path APRÈS l'upload). Une contrainte NOT NULL ou un trigger refusant
-- les fiches sans photo bloquerait la création de fiche hors-ligne. Si la
-- règle devient indispensable : prévoir un contrôle différé (rapport admin
-- listant les fiches sans photo_path depuis plus de N jours) plutôt qu'un
-- refus à l'INSERT.
--
-- Idempotent : peut être exécuté plusieurs fois sans erreur.
-- =============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('census-photos', 'census-photos', false, 2097152, ARRAY['image/jpeg', 'image/webp', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/jpeg', 'image/webp', 'image/png'];

DROP POLICY IF EXISTS "Agents can upload own census photos" ON storage.objects;
DROP POLICY IF EXISTS "Agents can update own census photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own census photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin can read all census photos" ON storage.objects;

-- Écriture : un agent approuvé ne peut écrire QUE dans son propre dossier.
CREATE POLICY "Agents can upload own census photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'census-photos'
    AND (SELECT public.is_approved_user())
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Réécriture (upsert:true d'un retry de sync) : même périmètre que l'INSERT.
CREATE POLICY "Agents can update own census photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'census-photos'
    AND (SELECT public.is_approved_user())
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'census-photos'
    AND (SELECT public.is_approved_user())
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Lecture : le propriétaire de la photo, ou un admin (paie / vérification).
CREATE POLICY "Users can read own census photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'census-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY "Admin can read all census photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'census-photos' AND (SELECT public.is_admin_user()));

-- Référence de la photo sur la fiche. Nullable (voir note ci-dessus).
ALTER TABLE public.census_points ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- Vérification post-application
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'census-photos';
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE '%census photos%';
