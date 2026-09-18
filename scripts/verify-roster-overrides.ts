/**
 * UAT-09 — verifies the emergency rostering override against the live database.
 *
 * Also re-runs UAT-T04's rest-rule refusal, because this work rewrote
 * enforce_roster_assignment_integrity() and that test is the regression guard for it.
 *
 * Everything is seeded inside a transaction that is always rolled back. Roles are impersonated
 * via request.jwt.claims because every RPC here reads auth.uid() and get_my_role().
 *
 * Run: export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-) \
 *      && bun scripts/verify-roster-overrides.ts
 */
import { SQL } from "bun";
import { parseRosterRefusal } from "../src/lib/roster-overrides";
import { buildShortageRows } from "../src/lib/roster-shortages";

const sql = new SQL(process.env.SUPABASE_DB_URL!);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const ROLLBACK = "intentional-rollback";

/** Runs fn, returning the error message if it threw. Savepointed so a refusal — which is the
 *  expected outcome for most of these — does not abort the verification transaction. */
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

try {
  await sql.begin(async (tx) => {
    const [tenant] = await tx`
      select t.id, t.name from public.tenants t
      where exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
        and exists (select 1 from public.employees e where e.tenant_id = t.id and e.status = 'active')
        and exists (select 1 from public.shift_types s where s.tenant_id = t.id and s.code = 'NIGHT')
      order by t.name limit 1`;
    if (!tenant) throw new Error("no usable tenant");

    const admins = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role = 'admin' and is_active limit 3`;
    const [admin, admin2, admin3] = admins;

    const [emp] = await tx`
      select id from public.employees where tenant_id = ${tenant.id} and status = 'active' limit 1`;
    const [site] = await tx`select id from public.sites where tenant_id = ${tenant.id} limit 1`;
    const [day] = await tx`
      select id from public.shift_types where tenant_id = ${tenant.id} and code = 'DAY' limit 1`;
    const [night] = await tx`
      select id from public.shift_types where tenant_id = ${tenant.id} and code = 'NIGHT' limit 1`;

    console.log(`tenant ${tenant.name}\n  employee ${emp.id}\n  admins ${admins.length}\n`);

    const asRole = async (profileId: string) => {
      await tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: profileId, role: "authenticated" })}'`,
      );
    };
    await asRole(admin.id);

    // A quiet week nothing else in the demo data touches.
    const SAT = "2027-03-06";
    const SUN = "2027-03-07";

    // ---------------------------------------------------------------------------------
    // UAT-T04 — rest rule refuses and explains why (regression guard for the rewrite)
    // ---------------------------------------------------------------------------------
    await tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
             values (${tenant.id}, ${emp.id}, ${site.id}, ${SAT}, ${night.id}, 12)`;

    const restErr = await attempt(
      tx,
      "rest",
      () =>
        tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, ${SUN}, ${day.id}, 12)`,
    );
    check(
      "UAT-T04 — a Day shift after a Night shift is refused",
      restErr !== null,
      restErr ?? "the insert was allowed, which is a regression",
    );
    check(
      "UAT-T04 — the refusal names the rule that failed",
      !!restErr && restErr.includes("Night shift the day before"),
      restErr ?? "no error raised",
    );

    const sameDayErr = await attempt(
      tx,
      "sameday",
      () =>
        tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, ${SAT}, ${day.id}, 12)`,
    );
    check(
      "a second working shift on the same day is refused",
      !!sameDayErr && sameDayErr.includes("already has a working shift"),
      sameDayErr ?? "the insert was allowed",
    );

    // ---------------------------------------------------------------------------------
    // Recording an override — the mandatory inputs
    // ---------------------------------------------------------------------------------
    const GOOD_REASON = "Site left unguarded after the relief guard was hospitalised.";

    const shortErr = await attempt(tx, "short", async () => {
      await tx.unsafe("set local role authenticated");
      await tx`select public.record_roster_override(${emp.id}::uuid, ${SUN}::date, array['night_to_day']::text[], 'too short', true, ${site.id}::uuid)`;
      await tx.unsafe("reset role");
    });
    await tx.unsafe("reset role");
    check(
      "a token reason is refused",
      !!shortErr && shortErr.includes("at least 20 characters"),
      shortErr ?? "a 9-character reason was accepted",
    );

    const noAckErr = await attempt(tx, "noack", async () => {
      await tx.unsafe("set local role authenticated");
      await tx`select public.record_roster_override(${emp.id}::uuid, ${SUN}::date, array['night_to_day']::text[], ${GOOD_REASON}, false, ${site.id}::uuid)`;
      await tx.unsafe("reset role");
    });
    await tx.unsafe("reset role");
    check(
      "the legal-risk acknowledgement is mandatory",
      !!noAckErr && noAckErr.includes("legal-risk acknowledgement"),
      noAckErr ?? "an unacknowledged override was accepted",
    );

    // Non-admin cannot authorise one.
    const [nonAdmin] = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role <> 'admin' and is_active limit 1`;
    if (nonAdmin) {
      const roleErr = await attempt(tx, "nonadmin", async () => {
        await asRole(nonAdmin.id);
        await tx.unsafe("set local role authenticated");
        await tx`select public.record_roster_override(${emp.id}::uuid, ${SUN}::date, array['night_to_day']::text[], ${GOOD_REASON}, true, ${site.id}::uuid)`;
        await tx.unsafe("reset role");
      });
      await tx.unsafe("reset role");
      await asRole(admin.id);
      check(
        "only an admin can authorise an override",
        !!roleErr && roleErr.includes("Only an admin"),
        roleErr ?? "a non-admin authorised an emergency override",
      );
    } else {
      console.log("SKIP  only an admin can authorise an override — no non-admin profile");
    }

    // ---------------------------------------------------------------------------------
    // An override covering the wrong rule must not help
    // ---------------------------------------------------------------------------------
    await tx.unsafe("set local role authenticated");
    const [wrongRule] = await tx`
      select public.record_roster_override(${emp.id}::uuid, ${SUN}::date, array['weekly_hours']::text[], ${GOOD_REASON}, true, ${site.id}::uuid) as id`;
    await tx.unsafe("reset role");

    const wrongErr = await attempt(
      tx,
      "wrongrule",
      () =>
        tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, ${SUN}, ${day.id}, 12)`,
    );
    check(
      "an override for a different rule does not unlock the assignment",
      wrongErr !== null,
      wrongErr ?? "a weekly_hours override wrongly authorised a night_to_day breach",
    );
    const [stillUnused] = await tx`
      select consumed_at from public.roster_emergency_overrides where id = ${wrongRule.id}`;
    check(
      "and it is not consumed by the attempt",
      stillUnused.consumed_at === null,
      `consumed_at is ${stillUnused.consumed_at ?? "null"}`,
    );

    // ---------------------------------------------------------------------------------
    // The real thing: a matching override lets the assignment through, once
    // ---------------------------------------------------------------------------------
    await tx.unsafe("set local role authenticated");
    const [good] = await tx`
      select public.record_roster_override(${emp.id}::uuid, ${SUN}::date, array['night_to_day']::text[], ${GOOD_REASON}, true, ${site.id}::uuid) as id`;
    await tx.unsafe("reset role");

    const allowedErr = await attempt(
      tx,
      "allowed",
      () =>
        tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, ${SUN}, ${day.id}, 12)`,
    );
    check(
      "a matching override lets the refused assignment through",
      allowedErr === null,
      allowedErr ?? "assignment created under the recorded override",
    );

    const [consumed] = await tx`
      select consumed_at, consumed_assignment_id from public.roster_emergency_overrides where id = ${good.id}`;
    check(
      "the override is consumed by the assignment that used it",
      consumed.consumed_at !== null && consumed.consumed_assignment_id !== null,
      `consumed_at=${consumed.consumed_at ? "set" : "null"}, assignment=${consumed.consumed_assignment_id ? "linked" : "null"}`,
    );

    // Single use: the next breach on the same date must be refused again.
    const MON = "2027-03-08";
    await tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
             values (${tenant.id}, ${emp.id}, ${site.id}, ${MON}, ${night.id}, 12)`;
    const reuseErr = await attempt(
      tx,
      "reuse",
      () =>
        tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
         values (${tenant.id}, ${emp.id}, ${site.id}, '2027-03-09', ${day.id}, 12)`,
    );
    check(
      "an override is single use and does not become a standing exemption",
      reuseErr !== null,
      reuseErr ?? "a consumed override authorised a second breach",
    );

    // ---------------------------------------------------------------------------------
    // Its own audit event, not an ordinary roster edit
    // ---------------------------------------------------------------------------------
    const audit = await tx`
      select action from public.audit_events
       where table_name = 'roster_emergency_overrides' and record_id = ${good.id}`;
    check(
      "the override raises its own audit event",
      audit.length > 0,
      `audit_events rows for this override: ${audit.map((a: { action: string }) => a.action).join(", ") || "none"}`,
    );

    // ---------------------------------------------------------------------------------
    // Post-hoc review: one person cannot fill two roles (approvals.ts chain)
    // ---------------------------------------------------------------------------------
    const selfVerifyErr = await attempt(tx, "selfverify", async () => {
      await tx.unsafe("set local role authenticated");
      await tx`select public.verify_roster_override(${good.id}::uuid)`;
      await tx.unsafe("reset role");
    });
    await tx.unsafe("reset role");
    check(
      "the person who authorised an override cannot verify it",
      !!selfVerifyErr && selfVerifyErr.includes("cannot verify"),
      selfVerifyErr ?? "the recorder verified their own override",
    );

    if (admin2) {
      await asRole(admin2.id);
      await tx.unsafe("set local role authenticated");
      await tx`select public.verify_roster_override(${good.id}::uuid)`;
      await tx.unsafe("reset role");
      const [v] =
        await tx`select status::text st from public.roster_emergency_overrides where id = ${good.id}`;
      check("a second person can verify it", v.st === "verified", `status is "${v.st}"`);

      const selfConfirmErr = await attempt(tx, "selfconfirm", async () => {
        await tx.unsafe("set local role authenticated");
        await tx`select public.confirm_roster_override(${good.id}::uuid)`;
        await tx.unsafe("reset role");
      });
      await tx.unsafe("reset role");
      check(
        "the verifier cannot also confirm",
        !!selfConfirmErr && selfConfirmErr.includes("third person"),
        selfConfirmErr ?? "the verifier confirmed their own verification",
      );

      if (admin3) {
        await asRole(admin3.id);
        await tx.unsafe("set local role authenticated");
        await tx`select public.confirm_roster_override(${good.id}::uuid)`;
        await tx.unsafe("reset role");
        const [c] =
          await tx`select status::text st from public.roster_emergency_overrides where id = ${good.id}`;
        check("a third person can confirm it", c.st === "confirmed", `status is "${c.st}"`);
      } else {
        console.log("SKIP  a third person can confirm it — tenant has fewer than 3 admins");
      }
    } else {
      console.log("SKIP  verify/confirm chain — tenant has fewer than 2 admins");
    }

    // ---------------------------------------------------------------------------------
    // UAT-T07 — no assignment is created, and a shortage record identifies the gap and reasons
    // ---------------------------------------------------------------------------------
    // Two guards refused for the same night slot, which is the "nobody compliant" shape.
    const GAP_NIGHT = "2027-03-20";
    const GAP_DAY = "2027-03-21";
    const [emp2] = await tx`
      select id from public.employees
       where tenant_id = ${tenant.id} and status = 'active' and id <> ${emp.id} limit 1`;

    const gapRefusals: {
      row: Record<string, string>;
      refusal: ReturnType<typeof parseRosterRefusal>;
    }[] = [];
    for (const who of [emp.id, emp2.id]) {
      // Roster each guard on the night before so the Day shift breaches the rest rule.
      await tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
               values (${tenant.id}, ${who}, ${site.id}, ${GAP_NIGHT}, ${night.id}, 12)`;
      const err = await attempt(
        tx,
        `gap_${who.slice(0, 8).replace(/-/g, "")}`,
        () =>
          tx`insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
           values (${tenant.id}, ${who}, ${site.id}, ${GAP_DAY}, ${day.id}, 12)`,
      );
      // The driver surfaces the message; DETAIL is read by the client from PostgREST. Rebuild
      // the shape parseRosterRefusal receives so the register rows are built the real way.
      gapRefusals.push({
        row: { employee_id: who, site_id: site.id, date: GAP_DAY, shift_type_id: day.id },
        refusal: parseRosterRefusal({ message: err ?? "", details: "night_to_day" }),
      });
    }

    const created = await tx`
      select count(*)::int n from public.schedule_assignments
       where tenant_id = ${tenant.id} and date = ${GAP_DAY} and shift_type_id = ${day.id}`;
    check(
      "UAT-T07 — no assignment is created when nobody is compliant",
      created[0].n === 0,
      `${created[0].n} assignments exist for the contested slot`,
    );

    const shortageRows = buildShortageRows(
      gapRefusals.map((g) => ({ row: g.row as never, refusal: g.refusal! })),
      { kindOf: () => "day", nameOf: (id) => `Guard ${id.slice(0, 8)}` },
    );
    check(
      "UAT-T07 — the two refusals become one gap of two, not two gaps",
      shortageRows.length === 1 && shortageRows[0].unmet_count === 2,
      `${shortageRows.length} row(s), unmet_count=${shortageRows[0]?.unmet_count}`,
    );

    // Write it the way the scheduler does, as an authenticated operations user.
    await tx.unsafe("set local role authenticated");
    const inserted = await tx`
      insert into public.schedule_shortages
        (tenant_id, site_id, shortage_date, shift_kind, required_count, unmet_count, failed_eligibility, attempted_by)
      values (${tenant.id}, ${shortageRows[0].site_id}, ${shortageRows[0].shortage_date},
              ${shortageRows[0].shift_kind}, ${shortageRows[0].required_count},
              ${shortageRows[0].unmet_count},
              ${JSON.stringify(shortageRows[0].failed_eligibility)}::jsonb, ${admin.id})
      returning id, unmet_count, failed_eligibility`;
    await tx.unsafe("reset role");

    check(
      "UAT-T07 — the shortage register accepts the row the scheduler builds",
      inserted.length === 1 && inserted[0].unmet_count === 2,
      `register row created with unmet_count=${inserted[0]?.unmet_count}`,
    );
    // jsonb comes back as a string from the postgres driver; supabase-js parses it for the
    // browser. Normalise so the assertion is about the stored data, not the transport.
    const raw = inserted[0]?.failed_eligibility;
    const reasons: { reason: string }[] = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? JSON.parse(raw)
        : [];
    check(
      "UAT-T07 — and it carries the reason each guard was refused",
      reasons.length === 2 && reasons.every((r) => r.reason.includes("Night shift the day before")),
      reasons.map((r) => r.reason).join(" | ") || "no reasons stored",
    );

    // ---------------------------------------------------------------------------------
    // Grants: writes must go through the RPCs, and TRUNCATE must not be inherited
    // ---------------------------------------------------------------------------------
    const grants = await tx`
      select privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name='roster_emergency_overrides' and grantee='authenticated'`;
    const names = grants.map((g: { privilege_type: string }) => g.privilege_type).sort();
    check(
      "authenticated holds SELECT only on the override table",
      names.length === 1 && names[0] === "SELECT",
      `grants: ${names.join(", ") || "none"} (TRUNCATE here would bypass RLS)`,
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

await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed (all seed rows rolled back)`,
);
process.exit(failed.length ? 1 : 0);
