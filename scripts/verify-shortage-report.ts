/**
 * UAT-10 / UAT-T07 (report half) — verifies the weekly Ops/HR shortage report.
 *
 * The UAT-08 half (no assignment created, a shortage record identifies the gap and reasons)
 * is covered by scripts/verify-roster-overrides.ts. This covers what the report adds: the same
 * gaps grouped by site, shift and required skill, with recurrence across weeks.
 *
 * Seeds inside a transaction that is always rolled back.
 *
 * Run: export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-) \
 *      && bun scripts/verify-shortage-report.ts
 */
import { SQL } from "bun";
import { summarisePatterns, type WeeklyShortageRow } from "../src/lib/shortage-report";

const sql = new SQL(process.env.SUPABASE_DB_URL!);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const ROLLBACK = "intentional-rollback";

// The RPC returns `date` as a Date object over this driver and an ISO string via supabase-js.
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

try {
  await sql.begin(async (tx) => {
    const [tenant] = await tx`
      select t.id, t.name from public.tenants t
      where exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
        and (select count(*) from public.sites s where s.tenant_id = t.id) >= 2
      order by t.name limit 1`;
    if (!tenant) throw new Error("no tenant with an admin and two sites");

    const [admin] = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role = 'admin' and is_active limit 1`;
    const sites = await tx`
      select id, name from public.sites where tenant_id = ${tenant.id} order by name limit 2`;
    const [siteA, siteB] = sites;

    console.log(`tenant ${tenant.name}\n  site A ${siteA.name}\n  site B ${siteB.name}\n`);

    // Pin both grades rather than inheriting whatever the demo data happens to hold: site A
    // demands a grade so the "required skill" grouping has something to show, site B demands
    // none so the "Any" fallback is genuinely exercised.
    await tx`update public.sites set required_guard_grade = 'B' where id = ${siteA.id}`;
    await tx`update public.sites set required_guard_grade = null where id = ${siteB.id}`;

    const shortage = (siteId: string, date: string, kind: string, unmet: number) =>
      tx`insert into public.schedule_shortages
           (tenant_id, site_id, shortage_date, shift_kind, required_count, unmet_count, failed_eligibility, attempted_by)
         values (${tenant.id}, ${siteId}, ${date}, ${kind}, ${unmet}, ${unmet}, '[]'::jsonb, ${admin.id})`;

    // Site A night: three separate weeks -> a recurring vacancy.
    const d = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    await shortage(siteA.id, d(3), "night", 2);
    await shortage(siteA.id, d(10), "night", 1);
    await shortage(siteA.id, d(17), "night", 3);
    // Site A night, same week as the first -> must not count as a fourth week.
    await shortage(siteA.id, d(4), "night", 1);
    // Site A day: one week only -> an incident.
    await shortage(siteA.id, d(3), "day", 4);
    // Site B night: one week only.
    await shortage(siteB.id, d(10), "night", 1);
    // Outside the window entirely.
    await shortage(siteB.id, d(200), "night", 9);

    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: admin.id, role: "authenticated" })}'`,
    );
    await tx.unsafe("set local role authenticated");
    const raw = await tx`select * from public.report_weekly_shortages(8)`;
    await tx.unsafe("reset role");

    const rows: WeeklyShortageRow[] = raw.map((r: Record<string, unknown>) => ({
      week_start: iso(r.week_start),
      site_id: String(r.site_id),
      site_name: String(r.site_name),
      shift_kind: String(r.shift_kind),
      required_grade: String(r.required_grade),
      occurrences: Number(r.occurrences),
      days_affected: Number(r.days_affected),
      total_unmet: Number(r.total_unmet),
    }));

    check(
      "the report returns weekly rows",
      rows.length > 0,
      `${rows.length} weekly row(s) in the 8-week window`,
    );
    check(
      "it excludes shortages outside the requested window",
      !rows.some((r) => r.total_unmet === 9),
      "the 200-day-old shortage of 9 is not present",
    );
    check(
      "it reports the site's required grade as the skill dimension",
      rows.some((r) => r.site_id === siteA.id && r.required_grade === "B"),
      `site A grades seen: ${[...new Set(rows.filter((r) => r.site_id === siteA.id).map((r) => r.required_grade))].join(", ")}`,
    );
    check(
      "a site with no grade requirement reads as 'Any', not blank",
      rows.some((r) => r.site_id === siteB.id && r.required_grade === "Any"),
      `site B grades seen: ${[...new Set(rows.filter((r) => r.site_id === siteB.id).map((r) => r.required_grade))].join(", ")}`,
    );

    const patterns = summarisePatterns(rows);
    const aNight = patterns.find((p) => p.siteId === siteA.id && p.shiftKind === "night");
    const aDay = patterns.find((p) => p.siteId === siteA.id && p.shiftKind === "day");
    const bNight = patterns.find((p) => p.siteId === siteB.id && p.shiftKind === "night");

    check(
      "UAT-T07 (report) — a gap in three separate weeks is flagged recurring",
      !!aNight && aNight.recurring && aNight.weeksAffected === 3,
      `site A night: weeksAffected=${aNight?.weeksAffected}, recurring=${aNight?.recurring}`,
    );
    check(
      "two gaps in the same week count as one week, not two",
      !!aNight && aNight.totalUnmet === 7,
      `site A night total unmet = ${aNight?.totalUnmet} (2+1+3+1 across 3 weeks)`,
    );
    check(
      "UAT-T07 (report) — a single-week gap is not flagged as a vacancy",
      !!aDay && !aDay.recurring && aDay.weeksAffected === 1,
      `site A day: weeksAffected=${aDay?.weeksAffected}, recurring=${aDay?.recurring}`,
    );
    check(
      "day and night at the same site are separate recruitment problems",
      !!aNight && !!aDay && aNight.key !== aDay.key,
      `${aNight?.key} vs ${aDay?.key}`,
    );
    check(
      "different sites stay separate",
      !!bNight && bNight.siteId === siteB.id && !bNight.recurring,
      `site B night: weeksAffected=${bNight?.weeksAffected}`,
    );
    check(
      "the recurring vacancy is ranked above the one-off incidents",
      patterns[0]?.key === aNight?.key,
      `first pattern is ${patterns[0]?.siteName} ${patterns[0]?.shiftKind} (recurring=${patterns[0]?.recurring})`,
    );

    // The RPC is SECURITY INVOKER, so RLS on schedule_shortages applies to the caller.
    const [outsider] = await tx`
      select id from public.profiles where tenant_id <> ${tenant.id} and is_active limit 1`;
    if (outsider) {
      await tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: outsider.id, role: "authenticated" })}'`,
      );
      await tx.unsafe("set local role authenticated");
      const other = await tx`select * from public.report_weekly_shortages(8)`;
      await tx.unsafe("reset role");
      check(
        "another tenant sees none of these shortages",
        !other.some((r: Record<string, unknown>) => String(r.site_id) === siteA.id),
        `${other.length} row(s) returned, none of them site A`,
      );
    } else {
      console.log("SKIP  cross-tenant check — no profile in another tenant");
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
