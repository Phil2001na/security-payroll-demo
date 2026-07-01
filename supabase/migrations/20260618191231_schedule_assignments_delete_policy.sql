-- schedule_assignments has RLS enabled with SELECT/INSERT/UPDATE policies but no
-- DELETE policy, so every delete (Undo/Remove-range, and the clear-cell path in
-- the schedule Save flow) silently matches zero rows instead of erroring.
create policy schedule_assignments_delete on schedule_assignments
  for delete
  using (tenant_id = get_my_tenant_id());
