import { describe, expect, it } from "vitest";
import { buildShortageRows, type Refused, type ShortageContext } from "./roster-shortages";

const ctx: ShortageContext = {
  kindOf: (id) => (id === "night-shift" ? "night" : id === "leave-shift" ? "other" : "day"),
  nameOf: (id) => `Guard ${id}`,
};

const refused = (over: Partial<Refused["row"]> = {}, message = "Assignment refused"): Refused => ({
  row: {
    employee_id: "e1",
    site_id: "s1",
    date: "2027-03-07",
    shift_type_id: "day-shift",
    ...over,
  },
  refusal: { rules: ["night_to_day"], message, overridable: true },
});

describe("building shortage rows from refusals", () => {
  it("produces nothing when nothing was refused", () => {
    expect(buildShortageRows([], ctx)).toEqual([]);
  });

  it("records one gap for one refused guard, with the reason", () => {
    const rows = buildShortageRows([refused({}, "rest between shifts")], ctx);
    expect(rows).toEqual([
      {
        site_id: "s1",
        shortage_date: "2027-03-07",
        shift_kind: "day",
        required_count: 1,
        unmet_count: 1,
        failed_eligibility: [
          { employeeId: "e1", employeeName: "Guard e1", reason: "rest between shifts" },
        ],
      },
    ]);
  });

  it("groups guards refused for the same site, date and kind into one gap", () => {
    // Three guards turned away from the same Tuesday night at one gate is one gap of three,
    // which is what a recruiter acts on — not three unrelated gaps.
    const rows = buildShortageRows(
      [
        refused({ employee_id: "e1", shift_type_id: "night-shift" }),
        refused({ employee_id: "e2", shift_type_id: "night-shift" }),
        refused({ employee_id: "e3", shift_type_id: "night-shift" }),
      ],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_kind).toBe("night");
    expect(rows[0].required_count).toBe(3);
    expect(rows[0].unmet_count).toBe(3);
    expect(rows[0].failed_eligibility.map((f) => f.employeeId)).toEqual(["e1", "e2", "e3"]);
  });

  it("keeps different sites apart", () => {
    const rows = buildShortageRows(
      [refused({ site_id: "s1" }), refused({ site_id: "s2", employee_id: "e2" })],
      ctx,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.site_id).sort()).toEqual(["s1", "s2"]);
  });

  it("keeps different dates apart", () => {
    const rows = buildShortageRows(
      [refused({ date: "2027-03-07" }), refused({ date: "2027-03-08", employee_id: "e2" })],
      ctx,
    );
    expect(rows).toHaveLength(2);
  });

  it("keeps day and night apart on the same date and site", () => {
    const rows = buildShortageRows(
      [
        refused({ shift_type_id: "day-shift" }),
        refused({ shift_type_id: "night-shift", employee_id: "e2" }),
      ],
      ctx,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.shift_kind).sort()).toEqual(["day", "night"]);
  });

  it("skips shift kinds the register cannot represent", () => {
    // schedule_shortages only has day/night. A leave row can never reach an overridable
    // refusal, so dropping it is correct rather than losing a real gap.
    expect(buildShortageRows([refused({ shift_type_id: "leave-shift" })], ctx)).toEqual([]);
  });

  it("still records the reportable gaps when one row is unreportable", () => {
    const rows = buildShortageRows(
      [refused({ shift_type_id: "leave-shift" }), refused({ employee_id: "e2" })],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].failed_eligibility).toHaveLength(1);
    expect(rows[0].failed_eligibility[0].employeeId).toBe("e2");
  });

  it("satisfies the table's own CHECK constraints", () => {
    // schedule_shortages: required_count > 0, unmet_count > 0 and <= required_count.
    const rows = buildShortageRows(
      [refused({ employee_id: "e1" }), refused({ employee_id: "e2" })],
      ctx,
    );
    for (const r of rows) {
      expect(r.required_count).toBeGreaterThan(0);
      expect(r.unmet_count).toBeGreaterThan(0);
      expect(r.unmet_count).toBeLessThanOrEqual(r.required_count);
    }
  });

  it("carries the database's own refusal wording into the register", () => {
    const msg = "Assignment refused — these rules failed: weekly rest (no full day off that week)";
    const rows = buildShortageRows([refused({}, msg)], ctx);
    expect(rows[0].failed_eligibility[0].reason).toBe(msg);
  });
});
