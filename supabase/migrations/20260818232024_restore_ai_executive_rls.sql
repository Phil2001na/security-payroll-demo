-- Restore the owner-scoped AI policies from the authoritative AI foundation.
-- The live baseline shows tenant-wide permissive policies introduced outside
-- migration history; remove those before recreating the intended access model.

drop policy if exists ai_sessions_select on public.ai_conversation_sessions;
drop policy if exists ai_sessions_insert on public.ai_conversation_sessions;
drop policy if exists ai_messages_select on public.ai_conversation_messages;
drop policy if exists ai_messages_insert on public.ai_conversation_messages;
drop policy if exists ai_memories_select on public.ai_executive_memories;
drop policy if exists ai_memories_insert on public.ai_executive_memories;
drop policy if exists ai_audit_select on public.ai_audit_events;
drop policy if exists ai_audit_insert on public.ai_audit_events;

drop policy if exists "ceo_select_ai_sessions" on public.ai_conversation_sessions;
drop policy if exists "ceo_insert_ai_sessions" on public.ai_conversation_sessions;
drop policy if exists "ceo_update_own_ai_sessions" on public.ai_conversation_sessions;
drop policy if exists "ceo_select_ai_messages" on public.ai_conversation_messages;
drop policy if exists "ceo_insert_own_user_ai_messages" on public.ai_conversation_messages;
drop policy if exists "ceo_select_ai_memories" on public.ai_executive_memories;
drop policy if exists "ceo_manage_own_ai_memories" on public.ai_executive_memories;
drop policy if exists "ceo_select_ai_audit_events" on public.ai_audit_events;

create policy "ceo_select_ai_sessions"
  on public.ai_conversation_sessions for select to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and owner_user_id = auth.uid()
    and public.is_ceo_executive()
  );

create policy "ceo_insert_ai_sessions"
  on public.ai_conversation_sessions for insert to authenticated
  with check (
    tenant_id = public.get_my_tenant_id()
    and owner_user_id = auth.uid()
    and purpose = 'executive_read_only'
    and public.is_ceo_executive()
  );

create policy "ceo_update_own_ai_sessions"
  on public.ai_conversation_sessions for update to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and owner_user_id = auth.uid()
    and public.is_ceo_executive()
  )
  with check (
    tenant_id = public.get_my_tenant_id()
    and owner_user_id = auth.uid()
    and purpose = 'executive_read_only'
    and public.is_ceo_executive()
  );

create policy "ceo_select_ai_messages"
  on public.ai_conversation_messages for select to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and public.is_ceo_executive()
    and exists (
      select 1 from public.ai_conversation_sessions session
      where session.id = ai_conversation_messages.session_id
        and session.tenant_id = ai_conversation_messages.tenant_id
        and session.owner_user_id = auth.uid()
    )
  );

create policy "ceo_insert_own_user_ai_messages"
  on public.ai_conversation_messages for insert to authenticated
  with check (
    tenant_id = public.get_my_tenant_id()
    and actor_user_id = auth.uid()
    and role = 'user'
    and public.is_ceo_executive()
    and exists (
      select 1 from public.ai_conversation_sessions session
      where session.id = ai_conversation_messages.session_id
        and session.tenant_id = ai_conversation_messages.tenant_id
        and session.owner_user_id = auth.uid()
    )
  );

create policy "ceo_select_ai_memories"
  on public.ai_executive_memories for select to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and executive_user_id = auth.uid()
    and public.is_ceo_executive()
  );

create policy "ceo_manage_own_ai_memories"
  on public.ai_executive_memories for all to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and executive_user_id = auth.uid()
    and public.is_ceo_executive()
  )
  with check (
    tenant_id = public.get_my_tenant_id()
    and executive_user_id = auth.uid()
    and public.is_ceo_executive()
  );

create policy "ceo_select_ai_audit_events"
  on public.ai_audit_events for select to authenticated
  using (
    tenant_id = public.get_my_tenant_id()
    and user_id = auth.uid()
    and public.is_ceo_executive()
  );

-- The Edge Function writes audit rows using service_role. Do not add any
-- authenticated mutation policy for this immutable audit trail.
