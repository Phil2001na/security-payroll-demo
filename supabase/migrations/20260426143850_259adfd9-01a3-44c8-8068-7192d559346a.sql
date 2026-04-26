
-- Set search_path on the two helper functions that don't have it
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_edits_on_locked_period()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_status public.pay_period_status;
  v_period_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_period_id := COALESCE(OLD.pay_period_id, NULL);
  ELSE
    v_period_id := COALESCE(NEW.pay_period_id, NULL);
  END IF;
  IF v_period_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO v_status FROM public.pay_periods WHERE id = v_period_id;
  IF v_status IN ('locked','paid') THEN
    RAISE EXCEPTION 'Pay period is locked. No edits permitted on % (record %).', TG_TABLE_NAME, COALESCE(NEW.id, OLD.id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Tighten the photos bucket: keep direct file reads working but stop bucket listing
DROP POLICY IF EXISTS "photos_public_read" ON storage.objects;
CREATE POLICY "photos_authenticated_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'photos');
CREATE POLICY "photos_anon_read_signed" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'photos');
