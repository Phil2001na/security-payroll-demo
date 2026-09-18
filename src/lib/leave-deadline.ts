// UAT-15 — the statutory side of a leave decision, shown next to UAT-14's capacity figures.
//
// Labour Act s.23 gives every annual-leave cycle a date by which the leave must actually be
// taken. Decision §6 of DECISIONS-2026-09-03.md requires the approver to see that deadline
// risk *before* deciding, and explicitly leaves the cap-versus-deadline collision unresolved
// (D-16, out of scope): state the conflict, do not pick a winner.
//
// This is also why the risk is shown when REJECTING, not only when approving. "Never silently
// deny leave" is the whole point of UAT-15 — turning down the last request that could have
// discharged a statutory obligation is the denial that matters most.

import type { CapacityWarning } from "./leave-capacity";

// Matches LEAVE_PLANNER_WINDOW_DAYS on the planner tab so "approaching" means the same thing
// in both places; a guard the planner is already flagging must not look calm at approval time.
export const LEAVE_DEADLINE_WINDOW_DAYS = 90;

export type DeadlineLevel = "unknown" | "none" | "approaching" | "overdue";

export type DeadlineRisk = {
  level: DeadlineLevel;
  latestLeaveDate: string | null;
  daysRemaining: number | null;
  /**
   * Whether the requested leave actually lands on or before the deadline. A request that ends
   * after it does not discharge the obligation, so approving it still leaves the guard exposed
   * — the approver should know that before treating the approval as "handled".
   */
  clearsDeadline: boolean | null;
};

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function deadlineRisk(input: {
  latestLeaveDate: string | null | undefined;
  requestEnd: string | null | undefined;
  today: string;
}): DeadlineRisk {
  const { latestLeaveDate, requestEnd, today } = input;

  // No annual cycle on record is not the same as no risk. Saying "none" would quietly tell the
  // approver everything is fine when in fact nothing has been checked.
  if (!latestLeaveDate) {
    return { level: "unknown", latestLeaveDate: null, daysRemaining: null, clearsDeadline: null };
  }

  const daysRemaining = daysBetween(today, latestLeaveDate);
  const clearsDeadline = requestEnd ? requestEnd <= latestLeaveDate : null;
  const level: DeadlineLevel =
    daysRemaining < 0
      ? "overdue"
      : daysRemaining <= LEAVE_DEADLINE_WINDOW_DAYS
        ? "approaching"
        : "none";

  return { level, latestLeaveDate, daysRemaining, clearsDeadline };
}

export function describeDeadlineRisk(risk: DeadlineRisk): string {
  switch (risk.level) {
    case "unknown":
      return "No annual leave cycle on record for this employee, so the statutory deadline could not be checked.";
    case "overdue":
      return `Statutory deadline passed on ${risk.latestLeaveDate} — ${Math.abs(risk.daysRemaining!)} days ago.`;
    case "approaching":
      return `Annual leave must be taken by ${risk.latestLeaveDate} — ${risk.daysRemaining} days left.`;
    default:
      return `Annual leave must be taken by ${risk.latestLeaveDate}. Not urgent.`;
  }
}

/**
 * True when the approver is looking at a capacity warning and a live statutory deadline at the
 * same time. D-16 is explicitly out of scope, so nothing here decides which one wins — the UI
 * says both are true and leaves it with the human.
 */
export function hasCapacityDeadlineConflict(
  warnings: CapacityWarning[],
  risk: DeadlineRisk,
): boolean {
  return warnings.length > 0 && (risk.level === "overdue" || risk.level === "approaching");
}

/**
 * Rejecting leave that is already against the clock is the "silent denial" UAT-15 exists to
 * stop. It never blocks the rejection; it forces the approver to see what they are doing.
 */
export function rejectionNeedsDeadlineWarning(risk: DeadlineRisk): boolean {
  return risk.level === "overdue" || risk.level === "approaching";
}
