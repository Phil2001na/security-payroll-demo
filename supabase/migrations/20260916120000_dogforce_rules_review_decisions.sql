-- DogForce's answers to the business-rules review (submitted 2026-09-15 via
-- dogforce-rules-review.vercel.app). Four sections came back marked "change":
--
--   3. The working day   -- shifts run 06:00/18:00, not 07:00/19:00
--   6. Public holidays   -- paid at 1.5x, not 2x
--   7. Night work        -- no 6% night premium (already off; asserted here)
--   8. Allowances        -- "it's not allowance, it's deduction" -- no transport allowance
--
-- Sections 6 and 8 are DEPARTURES FROM THE PRODUCT DEFAULT, decided by the client.
-- Holiday pay at 1.5x is below the Labour Act s.21(5) default of 2x, and the reason
-- given was commercial ("we are shift based", "clients are also not paying the 6%"),
-- not legal. This migration records their instruction; it is not legal advice and it
-- does not change the default any other tenant gets. Everything here is tenant-scoped
-- and reversible from Admin -> Settings.

begin;

-- ---------------------------------------------------------------------------
-- 0. Product-wide: audit shift_types.
-- start_min/end_min decide which hours land in the statutory 20:00-07:00 night
-- band, so editing a shift type changes pay -- yet shift_types was the one
-- pay-affecting table with no audit trigger. Every change below is a shift-time
-- change, so close the gap before making them.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_shift_types on public.shift_types;
create trigger trg_audit_shift_types
  after insert or update or delete on public.shift_types
  for each row execute function public.write_audit_event();

do $$
declare
  dogforce uuid;
begin
  select id into dogforce
    from public.tenants
   where name = 'DogForce Security Service';

  if dogforce is null then
    raise notice 'DogForce tenant not present - skipping tenant-scoped changes.';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Section 3: the working day starts at 06:00, not 07:00.
  -- "Shift start at 1800hrs or 6 am not 1900hrs or 7am as purported."
  -- This matches the service_items catalog, which already prices guarding as
  -- 06h00-18h00 / 18h00-06h00 -- the roster was the side that was wrong.
  -- Knock-on: the statutory night band is 20:00-07:00, so a 12h night shift now
  -- overlaps it for 10 hours (20:00-06:00) instead of 11. Night hours are still
  -- counted and reported; with the premium off this changes no money.
  -- -------------------------------------------------------------------------
  update public.shift_types set start_min =  360, end_min = 1080 where tenant_id = dogforce and code = 'DAY';    -- 06:00-18:00
  update public.shift_types set start_min =  360, end_min =  720 where tenant_id = dogforce and code = 'DAY6';   -- 06:00-12:00
  update public.shift_types set start_min = 1080, end_min =  360 where tenant_id = dogforce and code = 'NIGHT';  -- 18:00-06:00
  update public.shift_types set start_min = 1080, end_min =    0 where tenant_id = dogforce and code = 'NIGHT6'; -- 18:00-00:00
  update public.shift_types set start_min =  360, end_min = 1080 where tenant_id = dogforce and code = 'PH';     -- 06:00-18:00
  update public.shift_types set start_min =  360, end_min = 1080 where tenant_id = dogforce and code = 'SUN';    -- 06:00-18:00

  -- -------------------------------------------------------------------------
  -- Section 6: public holidays at 1.5x.
  -- "No the rate we are using is 1.5 not x2 because we are a shift based and we
  -- are giving employees ample time."
  -- NOTE the consequence for a holiday that falls on a Sunday: an unrostered
  -- call-in still attracts the 2x Sunday default, so the holiday rate is no
  -- longer automatically the higher of the two. Section 6 of the rules document
  -- used to say "the holiday rate wins" -- that sentence is now wrong and has
  -- been rewritten to say which rate applies when.
  -- -------------------------------------------------------------------------
  update public.payroll_constants
     set value = 1.5,
         description = 'Public holiday pay multiplier. DogForce instruction 2026-09-15: 1.5x. '
                       'This is BELOW the Labour Act s.21(5) default of 2x and is the client''s '
                       'own decision, not the product default.'
   where tenant_id = dogforce
     and key = 'public_holiday_multiplier';

  -- Keep the shift type's displayed multiplier honest. The engine pays from
  -- payroll_constants, not from this column, but the /schedule UI shows it.
  update public.shift_types
     set rate_multiplier = 1.5
   where tenant_id = dogforce
     and code = 'PH';

  -- -------------------------------------------------------------------------
  -- Section 7: no night premium.
  -- "The rates are the same, we are not paying the 6% because clients are also
  -- not paying the 6%." This confirms the state the system was already in --
  -- the document flagged it as an open decision and the client has now closed
  -- it. Asserted rather than assumed so the migration is self-contained.
  -- -------------------------------------------------------------------------
  update public.tenants
     set night_premium_enabled = false
   where id = dogforce;

  -- -------------------------------------------------------------------------
  -- Section 8: no allowances.
  -- "Its not allowance its deduction." Transport was the only allowance in the
  -- system. Zeroed rather than deleted: the column, the proration rule and the
  -- payslip line all stay, so restoring it is a number change, not a rebuild.
  -- -------------------------------------------------------------------------
  update public.tenants
     set default_transport_allowance = 0
   where id = dogforce;

  update public.employees
     set transport_allowance = 0
   where tenant_id = dogforce
     and transport_allowance <> 0;
end;
$$;

commit;
