-- Equipment / uniform inventory tracking (UAT request: per-guard audit trail of
-- issued kit — when they got it, when they brought it back — with live stock).
--
-- Tables:
--   equipment_items  — tenant catalog with stock on hand (total owned / available in store)
--   equipment_issues — issuance ledger, one row per issue event; append-mostly audit trail
--
-- Stock integrity is enforced in the database by triggers (not client code):
--   insert issue        -> available -= qty (fails if it would go negative)
--   status -> returned  -> available += qty
--   status -> lost/damaged -> stock NOT restored (charge_amount records liability;
--                             payroll deduction stays a manual step in v1)
--   delete issued row   -> available += qty (undo of a mistaken issue)

create table public.equipment_items (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  category text not null default 'uniform'
    check (category in ('uniform','radio','firearm','torch','vehicle','other')),
  sku text,
  unit_cost numeric(12,2) default 0,
  quantity_total integer not null default 0 check (quantity_total >= 0),
  quantity_available integer not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint equipment_items_available_range
    check (quantity_available >= 0 and quantity_available <= quantity_total)
);

create table public.equipment_issues (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid not null references public.tenants(id),
  item_id uuid not null references public.equipment_items(id),
  employee_id uuid not null references public.employees(id),
  quantity integer not null default 1 check (quantity > 0),
  issued_at timestamp with time zone default now() not null,
  issued_by uuid,
  status text not null default 'issued'
    check (status in ('issued','returned','lost','damaged')),
  returned_at timestamp with time zone,
  returned_to uuid,
  condition_on_return text
    check (condition_on_return is null or condition_on_return in ('good','worn','damaged')),
  acknowledged boolean not null default false,
  charge_amount numeric(12,2),
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create index equipment_items_tenant_idx on public.equipment_items (tenant_id);
create index equipment_issues_tenant_idx on public.equipment_issues (tenant_id);
create index equipment_issues_employee_idx on public.equipment_issues (employee_id, issued_at desc);
create index equipment_issues_item_idx on public.equipment_issues (item_id);

create trigger equipment_items_touch_updated_at
  before update on public.equipment_items
  for each row execute function touch_updated_at();
create trigger equipment_issues_touch_updated_at
  before update on public.equipment_issues
  for each row execute function touch_updated_at();

-- Stock movement trigger. SECURITY DEFINER so the stock adjustment on
-- equipment_items succeeds under the caller's RLS-restricted role.
create or replace function public.apply_equipment_stock_movement()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  avail integer;
begin
  if tg_op = 'INSERT' then
    select quantity_available into avail
      from equipment_items where id = new.item_id and tenant_id = new.tenant_id
      for update;
    if avail is null then
      raise exception 'Equipment item not found in this tenant';
    end if;
    if avail < new.quantity then
      raise exception 'Only % unit(s) available for this item', avail;
    end if;
    update equipment_items
      set quantity_available = quantity_available - new.quantity
      where id = new.item_id;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.item_id <> old.item_id
       or new.quantity <> old.quantity
       or new.employee_id <> old.employee_id then
      raise exception 'Cannot change item, quantity or employee on an issue record — return it and issue again';
    end if;
    if old.status <> 'issued' and new.status <> old.status then
      raise exception 'This issue record is already closed (%)', old.status;
    end if;
    if old.status = 'issued' and new.status = 'returned' then
      update equipment_items
        set quantity_available = quantity_available + new.quantity
        where id = new.item_id;
    end if;
    -- lost / damaged: stock is not restored.
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      update equipment_items
        set quantity_available = quantity_available + old.quantity
        where id = old.item_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

revoke all on function public.apply_equipment_stock_movement() from anon, authenticated;

create trigger equipment_issues_stock_movement
  before insert or update or delete on public.equipment_issues
  for each row execute function public.apply_equipment_stock_movement();

-- RLS: two-layer pattern (permissive tenant scoping AND restrictive role gating),
-- matching 20260705100000_role_based_write_policies.sql. All tenant members can
-- read; writes are limited to the HR writer set. This client's payroll officer
-- runs day-to-day ops, so payroll is included. (Future: per-account permission
-- overrides — keep the role list in these policies and in the frontend
-- EQUIPMENT_WRITERS constant as the two single sources of truth.)

alter table public.equipment_items enable row level security;
alter table public.equipment_issues enable row level security;

do $do$
declare
  tbl text;
  cmd record;
  writers text[] := array['admin','operations','supervisor','payroll'];
begin
  foreach tbl in array array['equipment_items','equipment_issues'] loop
    -- permissive tenant-scoped policies, one per command
    execute format(
      'create policy %I on public.%I as permissive for select to public using (tenant_id = get_my_tenant_id())',
      tbl || '_select', tbl);
    execute format(
      'create policy %I on public.%I as permissive for insert to public with check (tenant_id = get_my_tenant_id())',
      tbl || '_insert', tbl);
    execute format(
      'create policy %I on public.%I as permissive for update to public using (tenant_id = get_my_tenant_id())',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I as permissive for delete to public using (tenant_id = get_my_tenant_id())',
      tbl || '_delete', tbl);
    -- restrictive role gating on writes
    for cmd in select * from (values ('insert'), ('update'), ('delete')) as c(op) loop
      if cmd.op = 'insert' then
        execute format(
          'create policy %I on public.%I as restrictive for insert to authenticated with check (public.get_my_role() = any (%L::text[]))',
          tbl || '_role_insert', tbl, writers);
      else
        execute format(
          'create policy %I on public.%I as restrictive for %s to authenticated using (public.get_my_role() = any (%L::text[]))',
          tbl || '_role_' || cmd.op, tbl, cmd.op, writers);
      end if;
    end loop;
  end loop;
end;
$do$;

revoke all on public.equipment_items from anon;
revoke all on public.equipment_issues from anon;
grant select, insert, update, delete on public.equipment_items to authenticated;
grant select, insert, update, delete on public.equipment_issues to authenticated;
