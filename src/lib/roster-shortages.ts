// UAT-08 — turning refused roster assignments into shortage-register rows.
//
// Decision §5 of DECISIONS-2026-09-03.md ends with "The shortage record is still created."
// buildFillPlan already records a slot nobody was eligible for. This covers the other route to
// the same staffing gap: a slot where a guard WAS chosen but the database refused the write.
// Both are Operations and HR asking "where are we short and why", so both belong in one
// register rather than one being a row and the other a toast.

import type { RosterRefusal } from "./roster-overrides";

export type RefusedRow = {
  employee_id: string;
  site_id: string;
  date: string;
  shift_type_id: string;
};

export type Refused = { row: RefusedRow; refusal: RosterRefusal };

export type ShortageKind = "day" | "night";

export type ShortageRow = {
  site_id: string;
  shortage_date: string;
  shift_kind: ShortageKind;
  required_count: number;
  unmet_count: number;
  failed_eligibility: { employeeId: string; employeeName: string; reason: string }[];
};

export type ShortageContext = {
  /** Resolves a shift type to a register-reportable kind. Anything else is skipped. */
  kindOf: (shiftTypeId: string) => string;
  nameOf: (employeeId: string) => string;
};

/**
 * Groups refusals into one row per site + date + shift kind, because that is the unit the
 * register reports on and the unit a recruiter acts on — three guards refused for the same
 * Tuesday night at one gate is one gap of three, not three separate gaps.
 */
export function buildShortageRows(refusals: Refused[], ctx: ShortageContext): ShortageRow[] {
  const groups = new Map<string, ShortageRow>();

  for (const r of refusals) {
    const kind = ctx.kindOf(r.row.shift_type_id);
    // The register only has day/night columns. A leave-type row can never reach an
    // overridable refusal anyway, so skipping is correct rather than lossy.
    if (kind !== "day" && kind !== "night") continue;

    const key = `${r.row.site_id}|${r.row.date}|${kind}`;
    const existing = groups.get(key);
    const entry = {
      employeeId: r.row.employee_id,
      employeeName: ctx.nameOf(r.row.employee_id),
      reason: r.refusal.message,
    };

    if (existing) {
      existing.failed_eligibility.push(entry);
      existing.required_count += 1;
      existing.unmet_count += 1;
    } else {
      groups.set(key, {
        site_id: r.row.site_id,
        shortage_date: r.row.date,
        shift_kind: kind,
        required_count: 1,
        unmet_count: 1,
        failed_eligibility: [entry],
      });
    }
  }

  return [...groups.values()];
}
