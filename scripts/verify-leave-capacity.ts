/**
 * UAT-14 / UAT-T10 (cap half) — verifies preview_annual_leave_capacity against the live database.
 *
 * Everything is seeded inside a transaction that is always rolled back, so the script is
 * safe to re-run and leaves no rows behind. It impersonates a real profile via
 * request.jwt.claims (the pattern CLAUDE.md asks for) because the function's role guard and
 * tenant scope both read auth.uid().
 *
 * Run: export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-) \
 *      && bun scripts/verify-leave-capacity.ts
 */
import { SQL } from "bun";
import { capacityWarnings, type CapacityRow } from "../src/lib/leave-capacity";
import { deadlineRisk, hasCapacityDeadlineConflict } from "../src/lib/leave-deadline";

const sql = new SQL(process.env.SUPABASE_DB_URL!);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const ROLLBACK = "intentional-rollback";

// The postgres driver hands back `date` columns as Date objects; supabase-js gives the browser
// ISO strings. The app modules are written against what the browser actually receives, so the
// rows are normalised here rather than loosening the types they expect.
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const asCapacityRows = (rows: Record<string, unknown>[]): CapacityRow[] =>
  rows.map((r) => ({
    leave_date: iso(r.leave_date),
    site_id: r.site_id == null ? null : String(r.site_id),
    approved_or_planned: Number(r.approved_or_planned),
    monthly_employee_count: Number(r.monthly_employee_count),
    max_employees: Number(r.max_employees),
  }));

try {
  await sql.begin(async (tx) => {
    const [tenant] = await tx`
      select t.id, t.name from public.tenants t
      where exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
        and (select count(*) from public.employees e where e.tenant_id = t.id and e.home_site_id is not null) > 4
      order by t.name limit 1`;
    if (!tenant) throw new Error("no tenant with an admin profile and sited employees");

    const admins = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role = 'admin' and is_active limit 2`;
    const [admin] = admins;
    // approve_leave_request refuses self-approval, so the seed is requested by someone else.
    const requester = admins[1] ?? admin;

    // Two sites at the same tenant: three employees at the first, one at the second. The
    // fourth employee is the whole point — a correct per-site count must ignore them.
    const sited = await tx`
      select id, home_site_id from public.employees
      where tenant_id = ${tenant.id} and home_site_id is not null and status = 'active'
      order by home_site_id, id`;
    const bySite = new Map<string, string[]>();
    for (const e of sited) {
      const list = bySite.get(e.home_site_id) ?? [];
      list.push(e.id);
      bySite.set(e.home_site_id, list);
    }
    const siteA = [...bySite.entries()].find(([, v]) => v.length >= 3);
    const siteB = [...bySite.entries()].find(([k, v]) => k !== siteA?.[0] && v.length >= 1);
    if (!siteA || !siteB) throw new Error("need one site with 3+ employees and another with 1+");
    const [a1, a2, a3] = siteA[1];
    const [b1] = siteB[1];
    const siteOf = new Map<string, string>([
      [a1, siteA[0]],
      [a2, siteA[0]],
      [a3, siteA[0]],
      [b1, siteB[0]],
    ]);

    console.log(
      `tenant ${tenant.name}\n  site A ${siteA[0]} -> ${a1}, ${a2}, ${a3}\n  site B ${siteB[0]} -> ${b1}\n`,
    );

    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: admin.id, role: "authenticated" })}'`,
    );

    // Cap of 2 so the seeded month is unambiguously over it.
    await tx`insert into public.annual_leave_capacity_policies (tenant_id, max_employees, effective_from, policy_owner)
             values (${tenant.id}, 2, current_date - 1, ${admin.id})`;

    const DAY = "2026-11-10";
    const [dayShift] = await tx`
      select id from public.shift_types where tenant_id = ${tenant.id} and code = 'DAY' limit 1`;
    const subject: string[] = [];
    for (const emp of [a1, a2, a3, b1]) {
      const [req] = await tx`
        insert into public.leave_requests (tenant_id, employee_id, leave_type, start_date, end_date, status, requested_by, reason)
        values (${tenant.id}, ${emp}, 'annual', ${DAY}, ${DAY}, 'submitted', ${requester.id}, 'UAT-14 verification seed')
        returning id`;
      await tx`insert into public.leave_request_days (tenant_id, request_id, employee_id, leave_date)
               values (${tenant.id}, ${req.id}, ${emp}, ${DAY})`;
      subject.push(req.id);
      // approve_leave_request refuses when no rostered working shift falls in the range, so
      // the day is rostered here — otherwise the warn-only check below would be measuring
      // that unrelated rule instead of the capacity and deadline findings.
      await tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
               values (${tenant.id}, ${emp}, ${siteOf.get(emp)}, ${DAY}, ${dayShift.id}, 12)`;
    }

    // --- the actual assertions, made as the authenticated admin -------------------------
    await tx.unsafe("set local role authenticated");
    const rows = await tx`select * from public.preview_annual_leave_capacity(${subject[0]}::uuid)`;
    await tx.unsafe("reset role");

    check(
      "returns one row per requested day",
      rows.length === 1,
      `expected 1 row for a one-day request, got ${rows.length}`,
    );

    const row = rows[0] ?? {};
    check(
      "day count is per-site, not tenant-wide",
      row.approved_or_planned === 3,
      `site A has 3 of the 4 seeded annual-leave employees; approved_or_planned=${row.approved_or_planned} (4 would mean the site filter is not applied)`,
    );
    check(
      "monthly count is tenant-wide",
      row.monthly_employee_count === 4,
      `all 4 seeded employees are off in that month; monthly_employee_count=${row.monthly_employee_count}`,
    );
    check(
      "reads max_employees from the effective policy",
      row.max_employees === 2,
      `seeded policy caps at 2; max_employees=${row.max_employees}`,
    );
    check(
      "resolves the site from home_site_id when the day has no roster site",
      row.site_id === siteA[0],
      `expected ${siteA[0]}, got ${row.site_id}`,
    );

    // --- UAT-T10: cap breach AND statutory deadline risk on the same request -------------
    // The scenario the acceptance test describes, run through the real RPC and the real
    // warning/risk modules the UI renders from. Seeds an annual cycle whose deadline is close
    // so both halves of the conflict are live at once.
    // latest_leave_date is GENERATED as cycle_end + 4 months (Labour Act s.23), so the
    // deadline is seeded by choosing the cycle end rather than written directly.
    const [cycle] = await tx`
      insert into public.leave_cycles (tenant_id, employee_id, leave_type, cycle_start, cycle_end, entitlement_units)
      values (${tenant.id}, ${a1}, 'annual', '2025-06-06', '2026-06-05', 24)
      returning latest_leave_date`;
    const DEADLINE = iso(cycle.latest_leave_date);

    await tx.unsafe("set local role authenticated");
    const combined = asCapacityRows(
      await tx`select * from public.preview_annual_leave_capacity(${subject[0]}::uuid)`,
    );
    await tx.unsafe("reset role");

    const warns = capacityWarnings(combined);
    const risk = deadlineRisk({
      latestLeaveDate: DEADLINE,
      requestEnd: DAY,
      today: "2026-09-17",
    });

    check(
      "UAT-T10 — the cap breach is detected",
      warns.length > 0,
      `capacityWarnings produced ${warns.length} warning(s) from the live preview: ${warns.map((w) => w.kind).join(", ") || "none"}`,
    );
    check(
      "UAT-T10 — the statutory deadline risk is detected",
      risk.level === "approaching",
      `deadline ${DEADLINE} is ${risk.daysRemaining} days out -> level "${risk.level}"`,
    );
    check(
      "UAT-T10 — the two are reported as a conflict, not silently resolved",
      hasCapacityDeadlineConflict(warns, risk),
      "hasCapacityDeadlineConflict() is true, so the dialog renders the D-16 'both are in play, the system does not decide' panel",
    );
    // The point of "warn only" is that the approval actually goes through. Assert it rather
    // than asserting a constant: approve past both a cap breach and a live statutory deadline.
    // Give the subject an annual balance to spend. The balance rule is a separate,
    // already-working gate; without this the warn-only check would trip on it instead of on
    // the capacity and deadline findings it is meant to exercise.
    await tx`delete from public.leave_balances where tenant_id = ${tenant.id} and employee_id = ${a1}`;
    await tx`insert into public.leave_balances (tenant_id, employee_id, annual_days, sick_days, compassionate_days)
             values (${tenant.id}, ${a1}, 20, 0, 0)`;

    // A savepoint so a refusal does not abort the whole verification transaction.
    let approvalError: string | null = null;
    await tx.unsafe("savepoint before_approval");
    try {
      await tx.unsafe("set local role authenticated");
      await tx`select public.approve_leave_request(${subject[0]}::uuid, 'UAT-T10: approving past the cap, deadline is closer')`;
      await tx.unsafe("reset role");
      await tx.unsafe("release savepoint before_approval");
    } catch (err) {
      approvalError = err instanceof Error ? err.message : String(err);
      await tx.unsafe("rollback to savepoint before_approval");
      await tx.unsafe("reset role");
    }
    const [after] =
      await tx`select status::text st from public.leave_requests where id = ${subject[0]}`;
    check(
      "UAT-T10 — neither finding blocks the approval (warn only)",
      after?.st === "approved",
      approvalError
        ? `approve_leave_request refused: ${approvalError}`
        : `request status is now "${after?.st}" despite 2 capacity warnings and an 18-day deadline`,
    );

    // --- role guard ---------------------------------------------------------------------
    const [viewer] = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role not in ('admin','operations','payroll') and is_active limit 1`;
    if (viewer) {
      await tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: viewer.id, role: "authenticated" })}'`,
      );
      await tx.unsafe("set local role authenticated");
      const denied =
        await tx`select * from public.preview_annual_leave_capacity(${subject[0]}::uuid)`;
      await tx.unsafe("reset role");
      check(
        "non-approving role sees nothing",
        denied.length === 0,
        `a role outside admin/operations/payroll got ${denied.length} rows`,
      );
    } else {
      console.log("SKIP  non-approving role sees nothing — no such profile in this tenant");
    }

    throw new Error(ROLLBACK);
  });
} catch (e) {
  if (!(e instanceof Error) || e.message !== ROLLBACK) {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    await sql.end();
    process.exit(1);
  }
}

await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed (all seed rows rolled back)`,
);
process.exit(failed.length ? 1 : 0);
