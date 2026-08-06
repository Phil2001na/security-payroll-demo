// One definition of the rules a roster has to satisfy (tracker #9 + #11, and the roster
// half of #7). They are checked together rather than one at a time because they trade off
// against each other: pairing off days pushes hours up toward the cap, and enforcing a
// minimum number of off days changes which pairs are even possible. Built as separate
// checks in separate places they would each pass while the roster as a whole failed.
//
// The 60h weekly cap is deliberately NOT here — it is already a hard block on the Schedule
// save path (with PS-exemption cover), and moving it would weaken it to a warning.
import { DEFAULT_MONTHLY_HOUR_CAP } from "./hour-caps";

export const MIN_OFF_DAYS_PER_PERIOD = 10;

export type RosterViolationKind = "min_off_days" | "unpaired_off_days" | "monthly_hour_cap";
// "warn" = the roster breaks a rule and someone should look; "info" = a preference the
// roster couldn't satisfy. The UI reports violations; the database independently blocks
// schedule writes that would leave fewer than ten calendar-month rest days.
export type RosterSeverity = "warn" | "info";

export type RosterViolation = {
  kind: RosterViolationKind;
  severity: RosterSeverity;
  employeeId: string;
  employeeName: string;
  message: string;
};

export type RosterShift = {
  employee_id: string;
  site_id: string;
  date: string;
  shift_type_id: string;
  planned_hours: number;
};
export type RosterEmployee = { id: string; surname: string; first_names: string };

function addIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addIso(d, 1)) out.push(d);
  return out;
}

// Consecutive runs of off days, in order — a run of length 1 is an unpaired off day.
export function offDayRuns(offDates: string[]): string[][] {
  const sorted = [...offDates].sort();
  const runs: string[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && addIso(last[last.length - 1], 1) === d) last.push(d);
    else runs.push([d]);
  }
  return runs;
}

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function validateRoster(args: {
  start: string;
  end: string;
  assignments: RosterShift[];
  employees: RosterEmployee[];
  // Leave and off-type shifts don't count as worked days — a guard on annual leave is
  // not resting in the sense this rule means.
  isWorkingShift: (shiftTypeId: string) => boolean;
  siteName: (siteId: string) => string;
  monthlyHourCap?: number;
}): RosterViolation[] {
  const { start, end, assignments, employees, isWorkingShift, siteName } = args;
  const cap = args.monthlyHourCap ?? DEFAULT_MONTHLY_HOUR_CAP;
  const allDates = datesBetween(start, end);
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Per employee: worked dates in range, and the shift on each (for the "why no pair" note)
  const worked = new Map<string, Map<string, RosterShift>>();
  const monthHours = new Map<string, number>(); // `${empId}|${YYYY-MM}`
  for (const a of assignments) {
    if (a.date < start || a.date > end) continue;
    if (!isWorkingShift(a.shift_type_id)) continue;
    if (!worked.has(a.employee_id)) worked.set(a.employee_id, new Map());
    worked.get(a.employee_id)!.set(a.date, a);
    const mk = `${a.employee_id}|${a.date.slice(0, 7)}`;
    monthHours.set(mk, (monthHours.get(mk) ?? 0) + Number(a.planned_hours || 0));
  }

  const out: RosterViolation[] = [];
  // Only guards who are actually rostered in this period are judged — an unrostered guard
  // trivially has every day off and would drown the real violations.
  for (const [empId, days] of worked) {
    const emp = empById.get(empId);
    const name = emp ? `${emp.surname}, ${emp.first_names}` : empId;
    const offDates = allDates.filter((d) => !days.has(d));

    if (offDates.length < MIN_OFF_DAYS_PER_PERIOD) {
      out.push({
        kind: "min_off_days", severity: "warn", employeeId: empId, employeeName: name,
        message: `${offDates.length} off day${offDates.length === 1 ? "" : "s"} in this period — the minimum is ${MIN_OFF_DAYS_PER_PERIOD}`,
      });
    }

    const runs = offDayRuns(offDates);
    const singles = runs.filter((r) => r.length === 1).map((r) => r[0]);
    if (singles.length > 0) {
      // Name what stopped the pair: the guard is rostered on both neighbouring days, and
      // where. That's the actual blocking constraint, not a guess at one.
      const reasons = singles.slice(0, 3).map((d) => {
        const before = days.get(addIso(d, -1));
        const after = days.get(addIso(d, 1));
        const sites = [before, after]
          .filter(Boolean)
          .map((s) => siteName(s!.site_id));
        const uniq = Array.from(new Set(sites));
        return uniq.length
          ? `${dayLabel(d)} (rostered either side at ${uniq.join(" / ")})`
          : dayLabel(d);
      });
      const more = singles.length > reasons.length ? ` +${singles.length - reasons.length} more` : "";
      out.push({
        kind: "unpaired_off_days", severity: "info", employeeId: empId, employeeName: name,
        message: `${singles.length} off day${singles.length === 1 ? "" : "s"} fell as a single instead of a pair: ${reasons.join(", ")}${more}`,
      });
    }
  }

  for (const [key, hours] of monthHours) {
    if (hours <= cap) continue;
    const [empId, month] = key.split("|");
    const emp = empById.get(empId);
    out.push({
      kind: "monthly_hour_cap", severity: "warn", employeeId: empId,
      employeeName: emp ? `${emp.surname}, ${emp.first_names}` : empId,
      message: `${Math.round(hours)}h rostered in ${month} — over the ${cap}h monthly cap`,
    });
  }

  const order: Record<RosterViolationKind, number> = {
    min_off_days: 0, monthly_hour_cap: 1, unpaired_off_days: 2,
  };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.employeeName.localeCompare(b.employeeName));
}

export const VIOLATION_LABEL: Record<RosterViolationKind, string> = {
  min_off_days: "Under 10 off days",
  monthly_hour_cap: "Over the monthly hour cap",
  unpaired_off_days: "Off days not paired",
};
