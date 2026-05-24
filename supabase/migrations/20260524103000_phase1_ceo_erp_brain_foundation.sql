-- ============================================================================
-- PHASE 1: CEO-ONLY ERP BRAIN FOUNDATION
-- Read-only assistant data layer: conversations, message history, executive
-- memory, and immutable AI audit logs.
--
-- Important: access is intentionally NOT inherited from admin/operations.
-- A user must be explicitly marked profiles.is_ceo_executive = true.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_ceo_executive BOOLEAN NOT NULL DEFAULT false;

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
      AND p.tenant_id = public.current_tenant_id()
      AND p.is_active = true
      AND p.is_ceo_executive = true
  )
$$;

CREATE TABLE IF NOT EXISTS public.ai_conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  purpose TEXT NOT NULL DEFAULT 'executive_read_only',
  model_provider TEXT NOT NULL DEFAULT 'anthropic',
  model_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT ai_conversation_sessions_status_check
    CHECK (status IN ('active', 'archived')),
  CONSTRAINT ai_conversation_sessions_purpose_check
    CHECK (purpose IN ('executive_read_only'))
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_tenant_created
  ON public.ai_conversation_sessions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_owner_created
  ON public.ai_conversation_sessions (owner_user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_sessions_touch ON public.ai_conversation_sessions;
CREATE TRIGGER trg_ai_sessions_touch
  BEFORE UPDATE ON public.ai_conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.ai_conversation_sessions(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_summary TEXT,
  data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  CONSTRAINT ai_conversation_messages_sources_array_check
    CHECK (jsonb_typeof(data_sources) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_session_created
  ON public.ai_conversation_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_created
  ON public.ai_conversation_messages (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_executive_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  executive_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_message_id UUID REFERENCES public.ai_conversation_messages(id) ON DELETE SET NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_executive_memories_type_check
    CHECK (memory_type IN ('preference', 'metric_focus', 'risk_focus', 'reporting_style', 'business_rule', 'watchlist')),
  CONSTRAINT ai_executive_memories_source_check
    CHECK (source IN ('manual', 'assistant_suggested', 'conversation_confirmed', 'system_seeded')),
  CONSTRAINT ai_executive_memories_sensitivity_check
    CHECK (sensitivity IN ('internal', 'confidential', 'restricted')),
  CONSTRAINT ai_executive_memories_status_check
    CHECK (status IN ('active', 'archived', 'rejected')),
  CONSTRAINT ai_executive_memories_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_exec_status
  ON public.ai_executive_memories (executive_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memories_tenant_type
  ON public.ai_executive_memories (tenant_id, memory_type, status);

DROP TRIGGER IF EXISTS trg_ai_memories_touch ON public.ai_executive_memories;
CREATE TRIGGER trg_ai_memories_touch
  BEFORE UPDATE ON public.ai_executive_memories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES public.ai_conversation_sessions(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.ai_conversation_messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  prompt_preview TEXT,
  response_hash TEXT,
  model_provider TEXT NOT NULL DEFAULT 'anthropic',
  model_name TEXT,
  data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows_examined INTEGER NOT NULL DEFAULT 0,
  token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_only BOOLEAN NOT NULL DEFAULT true,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_audit_events_type_check
    CHECK (event_type IN ('assistant_request', 'assistant_response', 'memory_read', 'memory_write', 'retrieval', 'safety_refusal', 'error')),
  CONSTRAINT ai_audit_events_sources_array_check
    CHECK (jsonb_typeof(data_sources) = 'array'),
  CONSTRAINT ai_audit_events_rows_examined_check
    CHECK (rows_examined >= 0),
  CONSTRAINT ai_audit_events_read_only_check
    CHECK (read_only = true)
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_tenant_created
  ON public.ai_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_created
  ON public.ai_audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_session_created
  ON public.ai_audit_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_event_type
  ON public.ai_audit_events (event_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_ai_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_events is immutable; create a new audit event instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_audit_no_update ON public.ai_audit_events;
CREATE TRIGGER trg_ai_audit_no_update
  BEFORE UPDATE ON public.ai_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_audit_mutation();

DROP TRIGGER IF EXISTS trg_ai_audit_no_delete ON public.ai_audit_events;
CREATE TRIGGER trg_ai_audit_no_delete
  BEFORE DELETE ON public.ai_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_audit_mutation();

-- Keep session activity timestamps current without allowing raw table dumps or actions.
CREATE OR REPLACE FUNCTION public.touch_ai_session_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_conversation_sessions
  SET last_message_at = NEW.created_at,
      updated_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_messages_touch_session ON public.ai_conversation_messages;
CREATE TRIGGER trg_ai_messages_touch_session
  AFTER INSERT ON public.ai_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_session_from_message();

ALTER TABLE public.ai_conversation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_executive_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_events ENABLE ROW LEVEL SECURITY;

-- CEO-only session access. Admin/operations do not bypass this.
DROP POLICY IF EXISTS "ceo_select_ai_sessions" ON public.ai_conversation_sessions;
CREATE POLICY "ceo_select_ai_sessions"
  ON public.ai_conversation_sessions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND owner_user_id = auth.uid()
    AND public.is_ceo_executive()
  );

DROP POLICY IF EXISTS "ceo_insert_ai_sessions" ON public.ai_conversation_sessions;
CREATE POLICY "ceo_insert_ai_sessions"
  ON public.ai_conversation_sessions
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND owner_user_id = auth.uid()
    AND public.is_ceo_executive()
    AND purpose = 'executive_read_only'
  );

DROP POLICY IF EXISTS "ceo_update_own_ai_sessions" ON public.ai_conversation_sessions;
CREATE POLICY "ceo_update_own_ai_sessions"
  ON public.ai_conversation_sessions
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND owner_user_id = auth.uid()
    AND public.is_ceo_executive()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND owner_user_id = auth.uid()
    AND public.is_ceo_executive()
    AND purpose = 'executive_read_only'
  );

DROP POLICY IF EXISTS "ceo_select_ai_messages" ON public.ai_conversation_messages;
CREATE POLICY "ceo_select_ai_messages"
  ON public.ai_conversation_messages
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_ceo_executive()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversation_sessions s
      WHERE s.id = ai_conversation_messages.session_id
        AND s.tenant_id = ai_conversation_messages.tenant_id
        AND s.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ceo_insert_own_user_ai_messages" ON public.ai_conversation_messages;
CREATE POLICY "ceo_insert_own_user_ai_messages"
  ON public.ai_conversation_messages
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND actor_user_id = auth.uid()
    AND role = 'user'
    AND public.is_ceo_executive()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversation_sessions s
      WHERE s.id = session_id
        AND s.tenant_id = ai_conversation_messages.tenant_id
        AND s.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ceo_select_ai_memories" ON public.ai_executive_memories;
CREATE POLICY "ceo_select_ai_memories"
  ON public.ai_executive_memories
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND executive_user_id = auth.uid()
    AND public.is_ceo_executive()
  );

DROP POLICY IF EXISTS "ceo_manage_own_ai_memories" ON public.ai_executive_memories;
CREATE POLICY "ceo_manage_own_ai_memories"
  ON public.ai_executive_memories
  FOR ALL
  USING (
    tenant_id = public.current_tenant_id()
    AND executive_user_id = auth.uid()
    AND public.is_ceo_executive()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND executive_user_id = auth.uid()
    AND public.is_ceo_executive()
  );

DROP POLICY IF EXISTS "ceo_select_ai_audit_events" ON public.ai_audit_events;
CREATE POLICY "ceo_select_ai_audit_events"
  ON public.ai_audit_events
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND user_id = auth.uid()
    AND public.is_ceo_executive()
  );

-- No authenticated INSERT/UPDATE/DELETE policies on ai_audit_events.
-- Edge Functions using the service role can append rows; the immutable triggers
-- prevent update/delete even if a privileged SQL path is accidentally used.

COMMENT ON COLUMN public.profiles.is_ceo_executive IS
  'Explicit CEO assistant entitlement. Admin/operations roles do not imply this flag.';
COMMENT ON TABLE public.ai_conversation_sessions IS
  'CEO-only erp-brain chat sessions. Phase 1 is read-only and executive_read_only only.';
COMMENT ON TABLE public.ai_conversation_messages IS
  'Stateful erp-brain message history with structural retrieval metadata, not raw table dumps.';
COMMENT ON TABLE public.ai_executive_memories IS
  'Long-term CEO preferences, metric focus, watchlists, and reporting style memories.';
COMMENT ON TABLE public.ai_audit_events IS
  'Immutable audit trail for every erp-brain request, retrieval, memory access, response, and error.';
