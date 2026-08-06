import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260803181750_leave_management_module.sql",
);
const sql = readFileSync(migrationPath, "utf8");

const requires = (description: string, pattern: RegExp) => {
  assert.match(sql, pattern, `Migration is missing: ${description}`);
};

for (const table of [
  "leave_policies",
  "leave_requests",
  "leave_request_days",
  "leave_cycles",
  "leave_ledger",
  "leave_coverage",
]) {
  requires(
    `${table} RLS`,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
  );
}

requires("requester/approver separation", /decided_by is null or decided_by <> requested_by/i);
requires("self-approval runtime guard", /requester cannot approve their own leave submission/i);
requires("published-roster approval guard", /Publish the roster before approving leave/i);
requires("locked-payroll approval guard", /Leave overlaps a locked payroll period/i);
requires("locked-payroll cancellation guard", /Cannot cancel leave in a locked payroll period/i);
requires("12-week maternity minimum", /p_end-p_start\+1<84/i);
requires("six-month maternity service", /requires six months of continuous service/i);
requires(
  "statutory paid-leave floor",
  /Annual, sick and compassionate leave must remain 100%% paid/i,
);
requires("unpaid leave zero-pay rule", /Unpaid leave must remain 0%% paid/i);
requires("emergency retrospective submission", /p_type not in \('sick','compassionate'\)/i);
requires("one-day charge for multi-shift dates", /update leave_request_days set charge_units = 1/i);
requires("one coverage record per vacated assignment", /insert into leave_coverage/i);
requires(
  "replacement weekly-hours guard",
  /employee_week_hours\(p_employee, v_cov\.coverage_date\).*?> 60/is,
);
requires("replacement active-leave guard", /Replacement employee has active leave on this date/i);
requires("immutable ledger trigger", /leave_ledger_immutable before update or delete/i);
requires("annual accrual last-working-day cap", /x\.last_working_day between v_start and v_end/i);
requires("annual accrual exact cycle denominator", /cycle_start\+interval '1 year'/i);
requires("idempotent annual accrual", /on conflict\(employee_id,pay_period_id\) do nothing/i);
requires("private evidence bucket", /values \('leave-evidence','leave-evidence',false\)/i);
requires(
  "privileged RPC public revocation",
  /revoke all on function public\.approve_leave_request\(uuid,text\) from public,anon/i,
);

for (const table of ["leave_requests", "leave_cycles", "leave_ledger", "leave_coverage"]) {
  requires(`${table} audit trigger`, new RegExp(`create trigger ${table}_audit`, "i"));
}

assert.doesNotMatch(
  sql,
  /grant\s+(insert|update|delete|all)\s+on\s+public\.leave_/i,
  "Browser roles must not receive direct leave-table write grants",
);

console.log("Leave migration static invariants passed");
