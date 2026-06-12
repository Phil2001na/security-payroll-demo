-- Clients become first-class records (one client → many sites), invoices point
-- at clients (site detail moves to invoices.site_id), service_items catalog for
-- the invoice form dropdown, and a private receipts bucket for AP bills.
-- Applied to live project nakvdkkezgdqxytygtqp on 2026-06-12 via MCP apply_migration.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  vat_number text,
  payment_terms_days integer,            -- null → use tenant default
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create policy clients_select on public.clients for select using (tenant_id = get_my_tenant_id());
create policy clients_insert on public.clients for insert with check (tenant_id = get_my_tenant_id());
create policy clients_update on public.clients for update using (tenant_id = get_my_tenant_id()) with check (tenant_id = get_my_tenant_id());
create policy clients_delete on public.clients for delete using (tenant_id = get_my_tenant_id());
create trigger clients_touch_updated_at before update on public.clients
  for each row execute function public.touch_updated_at();
create unique index clients_tenant_name_uniq on public.clients (tenant_id, lower(name));

create table public.service_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  description text,
  unit text not null default 'hour',
  default_rate numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_items enable row level security;
create policy service_items_select on public.service_items for select using (tenant_id = get_my_tenant_id());
create policy service_items_insert on public.service_items for insert with check (tenant_id = get_my_tenant_id());
create policy service_items_update on public.service_items for update using (tenant_id = get_my_tenant_id()) with check (tenant_id = get_my_tenant_id());
create policy service_items_delete on public.service_items for delete using (tenant_id = get_my_tenant_id());
create trigger service_items_touch_updated_at before update on public.service_items
  for each row execute function public.touch_updated_at();

insert into public.service_items (tenant_id, name, description, unit, default_rate)
select t.id, s.name, s.description, s.unit, s.rate
from public.tenants t
cross join (values
  ('Guarding — Day shift',        'Unarmed security officer, 06h00–18h00', 'hour',    35.00),
  ('Guarding — Night shift',      'Unarmed security officer, 18h00–06h00', 'hour',    40.00),
  ('Armed guarding',              'Armed security officer',                 'hour',    55.00),
  ('Site supervisor',             'On-site supervisor',                     'hour',    45.00),
  ('Armed response callout',      'Armed response unit dispatched to site', 'callout', 250.00),
  ('Alarm monitoring',            '24/7 alarm monitoring service',          'month',   450.00),
  ('CCTV monitoring',             'Off-site CCTV monitoring',               'month',   850.00),
  ('K9 patrol unit',              'Handler and patrol dog per shift',       'shift',   650.00),
  ('Event security',              'Security officer per event deployment',  'event',   500.00),
  ('Cash-in-transit escort',      'Escort per trip',                        'trip',    400.00)
) as s(name, description, unit, rate);

alter table public.sites add column client_id uuid references public.clients(id);

insert into public.clients (tenant_id, name, email, address)
select s.tenant_id,
       coalesce(nullif(trim(s.client_name), ''), s.name),
       max(s.client_contact_email),
       max(s.client_address)
from public.sites s
group by s.tenant_id, coalesce(nullif(trim(s.client_name), ''), s.name)
on conflict do nothing;

update public.sites s
set client_id = c.id
from public.clients c
where c.tenant_id = s.tenant_id
  and lower(c.name) = lower(coalesce(nullif(trim(s.client_name), ''), s.name));

alter table public.invoices add column site_id uuid references public.sites(id);
alter table public.invoices add column receipt_url text;

-- existing AR invoices: client_id held a site id
update public.invoices set site_id = client_id where client_id is not null;
alter table public.invoices drop constraint invoices_client_id_fkey;
update public.invoices i
set client_id = s.client_id
from public.sites s
where i.site_id = s.id;
alter table public.invoices
  add constraint invoices_client_id_fkey foreign key (client_id) references public.clients(id);

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = get_my_tenant_id()::text);
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = get_my_tenant_id()::text);
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = get_my_tenant_id()::text);

notify pgrst, 'reload schema';
