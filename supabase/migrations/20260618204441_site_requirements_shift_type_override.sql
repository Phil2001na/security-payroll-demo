-- Lets a site's manpower requirement pin a specific shift template (e.g. a 6h half
-- shift) per day/kind instead of always using the tenant's standard 12h Day/Night
-- shift. Null means "use the standard template", so existing rows are unaffected.
alter table site_requirements
  add column shift_type_id uuid references shift_types(id) on delete set null;

-- The dialog's save always upserted on (site_id, day_of_week, shift_kind), but no unique
-- constraint backed that — ON CONFLICT had nothing to resolve against, so every save
-- failed silently behind a toast. Existing rows have no duplicates, so this is safe to add.
alter table site_requirements
  add constraint site_requirements_site_day_kind_key unique (site_id, day_of_week, shift_kind);

-- Label omits "(6h)" — the Manpower dialog's dropdown already appends "(Nh)" from
-- default_hours, so baking hours into the label too would double up as "(6h) (6h)".
insert into shift_types (tenant_id, code, label, period, default_hours, pay_rule, active, is_leave)
values
  ('11111111-0000-0000-0000-000000000001', 'DAY6', 'Half Day Shift', 'day', 6, 'standard', true, false),
  ('11111111-0000-0000-0000-000000000001', 'NIGHT6', 'Half Night Shift', 'night', 6, 'standard', true, false);
