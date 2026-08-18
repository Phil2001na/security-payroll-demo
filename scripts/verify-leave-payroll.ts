import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { calculateNetPay, countWorkedDays, type ShiftLogRow } from "../src/lib/payroll-engine";
import { buildPayslipPDF } from "../src/lib/payslip-pdf";

const log = (
  id: string,
  date: string,
  hours: number,
  code: string,
  payRule: string,
  isLeave = false,
  plannedHours = hours,
): ShiftLogRow => ({
  id,
  employee_id: "employee-1",
  date,
  hours_worked: hours,
  night_hours: 0,
  status: "approved",
  schedule_assignments: { is_replacement: false, planned_hours: plannedHours },
  shift_types: { code, is_leave: isLeave, pay_rule: payRule, rate_multiplier: 1 },
});

const logs = [
  log("worked", "2026-08-03", 12, "DAY", "standard"),
  log("annual", "2026-08-04", 12, "LEAVE-ANNUAL", "leave", true, 12),
  log("sick", "2026-08-05", 12, "LEAVE-SICK", "leave", true, 12),
  log("compassionate", "2026-08-06", 12, "LEAVE-COMPASSIONATE", "leave", true, 12),
  log("maternity", "2026-08-07", 6, "LEAVE-MATERNITY", "leave", true, 12),
  log("unpaid", "2026-08-08", 0, "LEAVE-UNPAID", "off", true, 12),
];

const result = calculateNetPay({
  employee: {
    id: "employee-1",
    employee_code: "TEST-1",
    surname: "Test",
    first_names: "Guard",
    display_name: null,
    hourly_rate: 20,
    category: "officer",
    transport_allowance: 500,
    ordinarily_works_sundays: false,
    bank_name: null,
    bank_account_number: null,
  },
  logs,
  disciplinary: [],
  rosteredDays: 6,
  constants: {
    ssc_rate: 0,
    ssc_max_deduction: 0,
    tax_free_threshold: 100_000,
    min_wage_security: 16,
    vet_threshold: 83_333,
    vet_rate: 0.01,
    night_premium_rate: 0.06,
    overtime_multiplier: 1.5,
    sunday_multiplier: 2,
    sunday_agreed_multiplier: 1.5,
    public_holiday_multiplier: 2,
    weekly_ordinary_cap: 60,
    periods_per_year: 12,
  },
  brackets: [],
});

assert.equal(countWorkedDays(logs), 1, "leave must not count as attendance");
assert.equal(result.annual_leave_hours, 12, "annual leave remains fully paid");
assert.equal(result.sick_leave_hours, 12);
assert.equal(result.compassionate_leave_hours, 12);
assert.equal(result.maternity_leave_hours, 12);
assert.equal(result.maternity_paid_hours, 6, "maternity policy may partially pay scheduled hours");
assert.equal(result.unpaid_leave_hours, 12, "unpaid leave must retain original scheduled hours");
assert.equal(result.normal_hours, 54, "paid leave remains ordinary-rate earnings");
assert.equal(result.normal_amount, 1080);
assert.equal(result.transport_allowance, 83.33, "transport must be based on actual attendance");
assert.equal(result.gross_salary, 1163.33);
assert.equal(result.net_salary, 1163.33);

if (process.env.LEAVE_PAYSLIP_OUTPUT) {
  const doc = buildPayslipPDF({
    calc: result,
    periodLabel: "August 2026",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    tenantName: "Leave Verification Company",
  });
  mkdirSync(dirname(process.env.LEAVE_PAYSLIP_OUTPUT), { recursive: true });
  writeFileSync(process.env.LEAVE_PAYSLIP_OUTPUT, Buffer.from(doc.output("arraybuffer")));
}

console.log("Leave payroll verification passed");
