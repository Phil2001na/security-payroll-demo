/**
 * UAT-05 / UAT-T05 — verifies the monthly hour cap hard-blocks on every write path and that
 * the UAT-09 admin override is the only authorised way past it.
 *
 * SAFETY: this script never changes payroll_constants outside a transaction that is always
 * rolled back. `monthly_cap_enforced` is switched on only inside that transaction so the block
 * can be exercised at all; whatever each tenant has set is restored by the rollback, and the
 * final check re-reads the live values to prove it.
 *
 * Run: export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-) \
 *      && bun scripts/verify-monthly-hour-cap.ts
 */
import { SQL } from "bun";

const sql = new SQL(process.env.SUPABASE_DB_URL!);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const ROLLBACK = "intentional-rollback";

async function attempt(tx: SQL, label: string, fn: () => Promise<unknown>): Promise<string | null> {
  await tx.unsafe(`savepoint sp_${label}`);
  try {
    await fn();
    await tx.unsafe(`release savepoint sp_${label}`);
    return null;
  } catch (e) {
    await tx.unsafe(`rollback to savepoint sp_${label}`);
    return e instanceof Error ? e.message : String(e);
  }
}

// Snapshot the live switch before touching anything, so the last check is meaningful.
const flagsBefore = await sql`
  select tenant_id::text tid, value from public.payroll_constants
   where key = 'monthly_cap_enforced' order by tenant_id`;

try {
  await sql.begin(async (tx) => {
    const [tenant] = await tx`
      select t.id, t.name from public.tenants t
      where exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
        and exists (select 1 from public.employees e where e.tenant_id = t.id and e.status = 'active')
        and exists (select 1 from public.shift_types s where s.tenant_id = t.id and s.code = 'DAY')
        and exists (select 1 from public.pay_periods pp where pp.tenant_id = t.id)
      order by t.name limit 1`;
    if (!tenant) throw new Error("no usable tenant");

    const [admin] = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role = 'admin' and is_active limit 1`;
    const [emp] = await tx`
      select id from public.employees where tenant_id = ${tenant.id} and status = 'active' limit 1`;
    const [site] = await tx`select id from public.sites where tenant_id = ${tenant.id} limit 1`;
    const [day] = await tx`
      select id from public.shift_types where tenant_id = ${tenant.id} and code = 'DAY' limit 1`;

    console.log(`tenant ${tenant.name}\n  employee ${emp.id}\n`);

    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: admin.id, role: "authenticated" })}'`,
    );

    // Two Day shifts, two weeks apart, so nothing but the MONTHLY cap can be the reason a
    // write is refused — no weekly hours, no weekly rest, no shift-to-shift rest involved.
    const FIRST = "2027-05-04";
    const SECOND = "2027-05-18";
    const insertSecond = () =>
      tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, ${SECOND}, ${day.id}, 12)`;

    // A cap of 20 makes two 12-hour shifts breach it. Cheaper and clearer than rostering 21
    // shifts to cross the real 240.
    await tx`update public.payroll_constants set value = 20
              where tenant_id = ${tenant.id} and key = 'monthly_hour_cap'`;

    // ---------------------------------------------------------------------------------
    // Warn-only mode leaves the database out of the way
    // ---------------------------------------------------------------------------------
    await tx`update public.payroll_constants set value = 0
              where tenant_id = ${tenant.id} and key = 'monthly_cap_enforced'`;
    await tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
             values (${tenant.id}, ${emp.id}, ${site.id}, ${FIRST}, ${day.id}, 12)`;
    const warnOnly = await attempt(tx, "warnonly", insertSecond);
    check(
      "with monthly_cap_enforced = 0 the database allows the write",
      warnOnly === null,
      warnOnly ?? "24 hours against a cap of 20 was allowed, as warn-only mode intends",
    );
    // Undo it so the enforced run starts from one shift, not two.
    await tx`delete from public.schedule_assignments
              where tenant_id = ${tenant.id} and employee_id = ${emp.id} and date = ${SECOND}`;

    // ---------------------------------------------------------------------------------
    // Enforced mode hard-blocks
    // ---------------------------------------------------------------------------------
    await tx`update public.payroll_constants set value = 1
              where tenant_id = ${tenant.id} and key = 'monthly_cap_enforced'`;

    const blocked = await attempt(tx, "blocked", insertSecond);
    check(
      "UAT-T05 — with enforcement on, exceeding the cap is refused",
      blocked !== null,
      blocked ?? "the write was allowed despite exceeding the cap",
    );
    check(
      "UAT-T05 — the refusal states the hours and the cap",
      !!blocked && blocked.includes("Monthly hour cap exceeded") && blocked.includes("24"),
      blocked ?? "no error raised",
    );

    // ---------------------------------------------------------------------------------
    // An override for a different rule is no help
    // ---------------------------------------------------------------------------------
    const REASON = "Client contract requires cover and no other guard is available.";
    await tx.unsafe("set local role authenticated");
    await tx`select public.record_roster_override(${emp.id}::uuid, ${SECOND}::date, array['weekly_rest']::text[], ${REASON}, true, ${site.id}::uuid)`;
    await tx.unsafe("reset role");

    const wrongRule = await attempt(tx, "wrongrule5", insertSecond);
    check(
      "an override for another rule does not unlock the monthly cap",
      wrongRule !== null,
      wrongRule ?? "a weekly_rest override wrongly authorised a monthly_hours breach",
    );

    // ---------------------------------------------------------------------------------
    // A monthly_hours override is the authorised way past it
    // ---------------------------------------------------------------------------------
    await tx.unsafe("set local role authenticated");
    const [ovr] = await tx`
      select public.record_roster_override(${emp.id}::uuid, ${SECOND}::date, array['monthly_hours']::text[], ${REASON}, true, ${site.id}::uuid) as id`;
    await tx.unsafe("reset role");

    const allowed = await attempt(tx, "allowed5", insertSecond);
    check(
      "UAT-T05 — a monthly_hours override lets the refused shift through",
      allowed === null,
      allowed ?? "shift rostered under the recorded override",
    );

    const [consumed] = await tx`
      select consumed_at, consumed_assignment_id from public.roster_emergency_overrides where id = ${ovr.id}`;
    check(
      "the override is consumed and linked to the assignment",
      consumed.consumed_at !== null && consumed.consumed_assignment_id !== null,
      `consumed_at=${consumed.consumed_at ? "set" : "null"}, assignment=${consumed.consumed_assignment_id ? "linked" : "null"}`,
    );

    // ---------------------------------------------------------------------------------
    // The shift_logs path blocks too — decision §5 says every write path
    // ---------------------------------------------------------------------------------
    const [period] = await tx`
      select id from public.pay_periods where tenant_id = ${tenant.id} order by start_date desc limit 1`;
    const LOG_DAY = "2027-05-20";
    const insertLog = () =>
      tx`insert into public.shift_logs (tenant_id, employee_id, pay_period_id, date, site_id, shift_type_id, hours_worked, status)
         values (${tenant.id}, ${emp.id}, ${period.id}, ${LOG_DAY}, ${site.id}, ${day.id}, 12, 'pending')`;

    // Two logs of 12h in the same month against the cap of 20.
    await tx`insert into public.shift_logs (tenant_id, employee_id, pay_period_id, date, site_id, shift_type_id, hours_worked, status)
             values (${tenant.id}, ${emp.id}, ${period.id}, '2027-05-19', ${site.id}, ${day.id}, 12, 'pending')`;
    const logBlocked = await attempt(tx, "logblocked", insertLog);
    check(
      "UAT-T05 — the cap also hard-blocks on shift_logs, not just the roster",
      !!logBlocked && logBlocked.includes("Monthly hour cap exceeded"),
      logBlocked ?? "an actuals write past the cap was allowed",
    );

    await tx.unsafe("set local role authenticated");
    await tx`select public.record_roster_override(${emp.id}::uuid, ${LOG_DAY}::date, array['monthly_hours']::text[], ${REASON}, true, ${site.id}::uuid)`;
    await tx.unsafe("reset role");
    const logAllowed = await attempt(tx, "logallowed", insertLog);
    check(
      "and the same override authorises the shift log",
      logAllowed === null,
      logAllowed ?? "shift log accepted under the override, with a null assignment link",
    );

    throw new Error(ROLLBACK);
  });
} catch (e) {
  if (!(e instanceof Error) || e.message !== ROLLBACK) {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    await sql.end();
    process.exit(1);
  }
}

// The whole point of the rollback: every tenant's switch is exactly where it was.
const flagsAfter = await sql`
  select tenant_id::text tid, value from public.payroll_constants
   where key = 'monthly_cap_enforced' order by tenant_id`;
check(
  "monthly_cap_enforced is untouched on live for every tenant",
  JSON.stringify(flagsBefore) === JSON.stringify(flagsAfter),
  `values: ${flagsAfter.map((f: { value: string }) => f.value).join(", ")}`,
);

await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed (all seed rows rolled back)`,
);
process.exit(failed.length ? 1 : 0);
