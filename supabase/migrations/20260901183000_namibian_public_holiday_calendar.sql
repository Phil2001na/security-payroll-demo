-- Namibian public holiday calendar.
--
-- 20260821120000_provision_payroll_defaults_for_new_tenants.sql deliberately refused to
-- seed public_holidays because Good Friday/Easter Monday/Ascension Day move with the year
-- and "a wrong guess would silently misprice holiday shifts". That objection is answered by
-- computing the movable feasts rather than transcribing them: namibian_public_holidays()
-- derives Easter with the Anonymous Gregorian algorithm, so any year is exact and no list
-- has to be maintained by hand.
--
-- Why this is needed now: the only tenant had 7 rows, all in 2025, none after 25 May. Every
-- 2026 public holiday was therefore pricing as an ordinary (or Sunday) day in run-payroll,
-- because calculateNetPay() only sees the dates this table supplies.
--
-- Statutory basis: Public Holidays Act 26 of 1990. Twelve annual holidays, plus Genocide
-- Remembrance Day (28 May), declared a public holiday by proclamation in Government Gazette
-- 8373 of 28 May 2024 and observed from 2025.

-- 1) Make seeding idempotent. Keyed on (tenant_id, date, name), NOT (tenant_id, date):
-- two distinct holidays can legitimately share a date — Africa Day and Ascension Day both
-- fall on 2028-05-25.
create unique index if not exists public_holidays_tenant_date_name_key
  on public.public_holidays (tenant_id, date, name);

-- 2) The calendar generator. Immutable and side-effect free: given a year, it returns that
-- year's holidays. Callers seed from it; nothing depends on it at payroll time.
create or replace function public.namibian_public_holidays(p_year integer)
returns table (holiday_date date, holiday_name text)
language plpgsql
immutable
set search_path = public
as $$
declare
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  easter_month int; easter_day int; easter_sunday date;
begin
  -- Anonymous Gregorian computus. Verified against the rows already in public_holidays:
  -- it reproduces Good Friday 2025-04-18 and Easter Monday 2025-04-21 exactly.
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  easter_month := (h + l - 7 * m + 114) / 31;
  easter_day := ((h + l - 7 * m + 114) % 31) + 1;
  easter_sunday := make_date(p_year, easter_month, easter_day);

  return query
  with base as (
    select * from (values
      (make_date(p_year, 1, 1),   'New Year''s Day'),
      (make_date(p_year, 3, 21),  'Independence Day'),
      (easter_sunday - 2,         'Good Friday'),
      (easter_sunday + 1,         'Easter Monday'),
      (make_date(p_year, 5, 1),   'Workers'' Day'),
      (make_date(p_year, 5, 4),   'Cassinga Day'),
      (easter_sunday + 39,        'Ascension Day'),
      (make_date(p_year, 5, 25),  'Africa Day'),
      (make_date(p_year, 5, 28),  'Genocide Remembrance Day'),
      (make_date(p_year, 8, 26),  'Heroes'' Day'),
      (make_date(p_year, 12, 10), 'International Human Rights Day'),
      (make_date(p_year, 12, 25), 'Christmas Day'),
      (make_date(p_year, 12, 26), 'Family Day')
    ) as v(d, n)
  )
  -- Public Holidays Act s.1(2): where a public holiday falls on a Sunday, the following
  -- Monday is also a public holiday. The Act adds the Monday; it does not move the holiday
  -- off the Sunday, so both dates are returned and both price at the holiday rate.
  select base.d, base.n from base
  union all
  select base.d + 1, base.n || ' (observed)' from base where extract(dow from base.d) = 0
  order by 1, 2;
end;
$$;

comment on function public.namibian_public_holidays(integer) is
  'Namibian public holidays for a given year per Public Holidays Act 26 of 1990, with Easter-derived dates computed rather than hardcoded, and the s.1(2) Sunday-to-Monday observance applied. Genocide Remembrance Day (28 May) per GG 8373 of 2024.';

revoke all on function public.namibian_public_holidays(integer) from public, anon;
grant execute on function public.namibian_public_holidays(integer) to authenticated;

-- 3) Seed 2026-2030 for every existing tenant.
-- 2025 and earlier is deliberately NOT backfilled here: those pay periods may be finalised,
-- and inserting a past holiday would change what a re-run of that period calculates. The
-- 2025 gaps are real (Ascension, Genocide Remembrance, Heroes', Human Rights, Christmas and
-- Family Day are all missing) but correcting them is a separate, evidenced decision.
insert into public.public_holidays (tenant_id, date, name)
select t.id, h.holiday_date, h.holiday_name
from public.tenants t
cross join lateral (
  select * from generate_series(2026, 2030) as y(year)
  cross join lateral public.namibian_public_holidays(y.year)
) h
on conflict (tenant_id, date, name) do nothing;
