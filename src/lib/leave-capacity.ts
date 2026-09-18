// UAT-14 — turning preview_annual_leave_capacity's rows into what an approver actually needs
// to see. Decision §6 of DECISIONS-2026-09-03.md: both checks WARN ONLY. Nothing here blocks
// an approval, and nothing here resolves a cap-versus-deadline collision (D-16, out of scope)
// — it states the conflict and leaves the decision with the human.

export type CapacityRow = {
  leave_date: string;
  site_id: string | null;
  approved_or_planned: number;
  monthly_employee_count: number;
  max_employees: number;
};

export type CapacityWarning =
  | { kind: "monthly"; month: string; count: number; max: number }
  | { kind: "site"; date: string; siteId: string | null; count: number };

// A site is flagged when the number of guards already off that day at that site reaches the
// same headcount the tenant chose as its monthly ceiling. There is no separate per-site
// number in the policy — §6 only defines one configurable figure — so it doubles as the
// day-level yardstick rather than inventing a threshold nobody decided on.
export function siteThreshold(maxEmployees: number): number {
  return Math.max(1, maxEmployees);
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Produces one monthly warning per distinct month over cap, and one site warning per day
 * over the day-level threshold. Ordered by date so the approver reads them chronologically.
 */
export function capacityWarnings(rows: CapacityRow[]): CapacityWarning[] {
  const warnings: CapacityWarning[] = [];
  const seenMonths = new Set<string>();

  for (const row of [...rows].sort((a, b) => a.leave_date.localeCompare(b.leave_date))) {
    const month = monthKey(row.leave_date);
    if (row.monthly_employee_count > row.max_employees && !seenMonths.has(month)) {
      seenMonths.add(month);
      warnings.push({
        kind: "monthly",
        month,
        count: row.monthly_employee_count,
        max: row.max_employees,
      });
    }
    if (row.approved_or_planned >= siteThreshold(row.max_employees)) {
      warnings.push({
        kind: "site",
        date: row.leave_date,
        siteId: row.site_id,
        count: row.approved_or_planned,
      });
    }
  }
  return warnings;
}

/**
 * True when the approver is about to approve past at least one warning. The UI uses this to
 * require a note — §6 says "the decision and its reason are recorded", and an approval note
 * is the only place that reason can live (approve_leave_request stores it in decision_notes).
 */
export function requiresReason(rows: CapacityRow[]): boolean {
  return capacityWarnings(rows).length > 0;
}

export function describeWarning(
  warning: CapacityWarning,
  siteName: (id: string | null) => string,
): string {
  if (warning.kind === "monthly") {
    return `${warning.count} employees have annual leave in ${warning.month}, above the cap of ${warning.max}.`;
  }
  return `${warning.count} already off at ${siteName(warning.siteId)} on ${warning.date}.`;
}
