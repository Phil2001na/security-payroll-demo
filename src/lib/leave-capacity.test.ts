import { describe, expect, it } from "vitest";
import {
  capacityWarnings,
  describeWarning,
  monthKey,
  requiresReason,
  siteThreshold,
  type CapacityRow,
} from "./leave-capacity";

const row = (over: Partial<CapacityRow> = {}): CapacityRow => ({
  leave_date: "2026-11-10",
  site_id: "site-a",
  approved_or_planned: 1,
  monthly_employee_count: 3,
  max_employees: 10,
  ...over,
});

describe("leave capacity warnings", () => {
  it("says nothing when both figures are inside the policy", () => {
    expect(capacityWarnings([row()])).toEqual([]);
    expect(requiresReason([row()])).toBe(false);
  });

  it("warns when the month is over the tenant cap", () => {
    const w = capacityWarnings([row({ monthly_employee_count: 11, max_employees: 10 })]);
    expect(w).toEqual([{ kind: "monthly", month: "2026-11", count: 11, max: 10 }]);
  });

  it("does not warn when the month exactly equals the cap", () => {
    // The cap is a maximum, not a ceiling to stay under — 10 of 10 is still within policy.
    expect(capacityWarnings([row({ monthly_employee_count: 10, max_employees: 10 })])).toEqual([]);
  });

  it("raises the monthly warning once per month, not once per day", () => {
    const rows = [
      row({ leave_date: "2026-11-10", monthly_employee_count: 11 }),
      row({ leave_date: "2026-11-11", monthly_employee_count: 11 }),
      row({ leave_date: "2026-11-12", monthly_employee_count: 11 }),
    ];
    expect(capacityWarnings(rows).filter((w) => w.kind === "monthly")).toHaveLength(1);
  });

  it("raises a monthly warning for each distinct month a range spans", () => {
    const rows = [
      row({ leave_date: "2026-11-30", monthly_employee_count: 11 }),
      row({ leave_date: "2026-12-01", monthly_employee_count: 12 }),
    ];
    const months = capacityWarnings(rows)
      .filter((w) => w.kind === "monthly")
      .map((w) => (w.kind === "monthly" ? w.month : ""));
    expect(months).toEqual(["2026-11", "2026-12"]);
  });

  it("warns per day when the site is already at the threshold", () => {
    const rows = [
      row({ leave_date: "2026-11-10", approved_or_planned: 10, max_employees: 10 }),
      row({ leave_date: "2026-11-11", approved_or_planned: 2, max_employees: 10 }),
    ];
    const site = capacityWarnings(rows).filter((w) => w.kind === "site");
    expect(site).toEqual([{ kind: "site", date: "2026-11-10", siteId: "site-a", count: 10 }]);
  });

  it("orders warnings chronologically regardless of row order", () => {
    const rows = [
      row({ leave_date: "2026-11-12", approved_or_planned: 10 }),
      row({ leave_date: "2026-11-10", approved_or_planned: 10 }),
    ];
    const dates = capacityWarnings(rows).map((w) => (w.kind === "site" ? w.date : ""));
    expect(dates).toEqual(["2026-11-10", "2026-11-12"]);
  });

  it("requires a reason whenever any warning is showing", () => {
    expect(requiresReason([row({ monthly_employee_count: 11, max_employees: 10 })])).toBe(true);
    expect(requiresReason([row({ approved_or_planned: 10, max_employees: 10 })])).toBe(true);
  });

  it("never lets the site threshold fall below one", () => {
    // max_employees has a >0 check in the DB, but a policy of 1 must still flag the first
    // guard off rather than computing a threshold of 0 and warning on an empty site.
    expect(siteThreshold(1)).toBe(1);
    expect(
      capacityWarnings([
        row({ approved_or_planned: 0, monthly_employee_count: 1, max_employees: 1 }),
      ]),
    ).toEqual([]);
  });

  it("handles an empty preview (no policy, no days) without warning", () => {
    expect(capacityWarnings([])).toEqual([]);
    expect(requiresReason([])).toBe(false);
  });

  it("describes both warning kinds in plain language", () => {
    const names = (id: string | null) => (id === "site-a" ? "Gate 4" : "an unassigned site");
    expect(describeWarning({ kind: "monthly", month: "2026-11", count: 11, max: 10 }, names)).toBe(
      "11 employees have annual leave in 2026-11, above the cap of 10.",
    );
    expect(
      describeWarning({ kind: "site", date: "2026-11-10", siteId: "site-a", count: 3 }, names),
    ).toBe("3 already off at Gate 4 on 2026-11-10.");
    expect(
      describeWarning({ kind: "site", date: "2026-11-10", siteId: null, count: 3 }, names),
    ).toBe("3 already off at an unassigned site on 2026-11-10.");
  });

  it("derives the month key from an ISO date", () => {
    expect(monthKey("2026-11-10")).toBe("2026-11");
  });
});
