-- Field supervisors (app_role 'security_supervisor') must be able to flag a guard on the
-- spot — sleeping on duty, AWOL, uniform, etc. — so payroll sees it during the
-- verification/confirmation step of a payroll run.
--
-- They get INSERT only, and only for the non-monetary warning types: fines, unpaid
-- suspensions and dismissals stay with admin/operations/supervisor/payroll, and nobody
-- with this role can edit or delete a record once it has been filed (separation of duties —
-- the person who reports the offence must not be able to walk it back silently).

drop policy if exists disciplinary_actions_role_insert on public.disciplinary_actions;

create policy disciplinary_actions_role_insert on public.disciplinary_actions
  as restrictive for insert to authenticated
  with check (
    get_my_role() = any (array['admin', 'operations', 'supervisor', 'payroll'])
    or (
      get_my_role() = 'security_supervisor'
      and action_type in ('verbal_warning', 'written_warning', 'final_warning')
      and coalesce(fine_amount, 0) = 0
      and coalesce(suspension_hours, 0) = 0
    )
  );

-- update / delete policies are intentionally left unchanged (security_supervisor excluded).
