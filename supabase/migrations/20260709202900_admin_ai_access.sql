-- Allow tenant admins to use the executive AI assistant without requiring the
-- separate CEO flag. The AI tables remain owner-scoped by their existing RLS
-- policies; this helper is the shared entitlement predicate.

CREATE OR REPLACE FUNCTION public.is_ceo_executive()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tenant_id = public.get_my_tenant_id()
      AND p.is_active = true
      AND (p.is_ceo_executive = true OR p.role = 'admin')
  )
$$;

COMMENT ON FUNCTION public.is_ceo_executive() IS
  'AI assistant entitlement helper: true for active CEO-executive profiles and active tenant admins.';
