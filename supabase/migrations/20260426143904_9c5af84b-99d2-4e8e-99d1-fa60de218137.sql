
UPDATE storage.buckets SET public = false WHERE id = 'photos';

DROP POLICY IF EXISTS "photos_authenticated_read" ON storage.objects;
DROP POLICY IF EXISTS "photos_anon_read_signed" ON storage.objects;

CREATE POLICY "photos_tenant_read" ON storage.objects FOR SELECT USING (
  bucket_id = 'photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
