import { describe, expect, it } from "vitest";
import {
  MIN_OVERRIDE_REASON_LENGTH,
  OVERRIDABLE_RULES,
  RULE_EXPOSURE,
  RULE_LABEL,
  canAuthoriseOverride,
  describeExposure,
  isOverridableRule,
  overrideBlockedReason,
  parseRosterRefusal,
} from "./roster-overrides";

const refusal = (details: string, message = "Assignment refused — this rule failed: x") => ({
  message,
  details,
  code: "23514",
});

describe("reading a roster refusal", () => {
  it("returns null for anything that is not an error object", () => {
    expect(parseRosterRefusal(null)).toBeNull();
    expect(parseRosterRefusal(undefined)).toBeNull();
    expect(parseRosterRefusal("boom")).toBeNull();
    expect(parseRosterRefusal({})).toBeNull();
  });

  it("returns null for an unrelated database error", () => {
    expect(
      parseRosterRefusal({
        message: "duplicate key value violates unique constraint",
        details: "",
      }),
    ).toBeNull();
  });

  it("takes the rule keys from DETAIL, not from the prose", () => {
    const r = parseRosterRefusal(refusal("night_to_day"));
    expect(r?.rules).toEqual(["night_to_day"]);
    expect(r?.overridable).toBe(true);
  });

  it("reads several rules from one refusal", () => {
    const r = parseRosterRefusal(refusal("weekly_hours,weekly_rest,night_to_day"));
    expect(r?.rules).toEqual(["weekly_hours", "weekly_rest", "night_to_day"]);
  });

  it("tolerates whitespace around the keys", () => {
    expect(parseRosterRefusal(refusal(" weekly_hours , weekly_rest "))?.rules).toEqual([
      "weekly_hours",
      "weekly_rest",
    ]);
  });

  it("ignores rule keys it does not recognise", () => {
    // A future rule the client has not been taught about must not become an override option.
    const r = parseRosterRefusal(refusal("weekly_rest,some_new_rule"));
    expect(r?.rules).toEqual(["weekly_rest"]);
  });

  it("marks a structural refusal as not overridable", () => {
    const dup = parseRosterRefusal({
      message: "Guard already has a working shift on 2027-03-06",
      details: "",
    });
    expect(dup).not.toBeNull();
    expect(dup?.overridable).toBe(false);
    expect(dup?.rules).toEqual([]);

    const kind = parseRosterRefusal({
      message: "Rostered work must use a Day or Night shift type",
      details: "",
    });
    expect(kind?.overridable).toBe(false);
  });

  it("recognises the monthly hour cap refusal, which comes from a different trigger", () => {
    // enforce_monthly_hour_cap raises its own exception with DETAIL 'monthly_hours'. UAT-05
    // depends on the client treating that identically to the integrity trigger's refusals,
    // so the same override flow is offered without any UAT-05-specific frontend code.
    const r = parseRosterRefusal({
      message:
        "Monthly hour cap exceeded: this would put the guard on 252.0 hours in May 2027 (cap 240.0)",
      details: "monthly_hours",
      code: "23514",
    });
    expect(r?.rules).toEqual(["monthly_hours"]);
    expect(r?.overridable).toBe(true);
    expect(r?.message).toContain("252.0 hours");
  });

  it("keeps the database's own wording for the human", () => {
    const msg = "Assignment refused — these rules failed: weekly rest (no full day off that week)";
    expect(parseRosterRefusal(refusal("weekly_rest", msg))?.message).toBe(msg);
  });
});

describe("who may authorise an override", () => {
  it("is admins only", () => {
    expect(canAuthoriseOverride("admin")).toBe(true);
    for (const role of ["operations", "payroll", "supervisor", "security_supervisor", "viewer"]) {
      expect(canAuthoriseOverride(role)).toBe(false);
    }
    expect(canAuthoriseOverride(undefined)).toBe(false);
    expect(canAuthoriseOverride(null)).toBe(false);
  });
});

describe("what blocks an override from being submitted", () => {
  const ok = {
    rules: ["night_to_day" as const],
    reason: "Relief guard hospitalised, site would be unmanned.",
    acknowledged: true,
  };

  it("accepts a complete draft", () => {
    expect(overrideBlockedReason(ok)).toBeNull();
  });

  it("requires at least one rule", () => {
    expect(overrideBlockedReason({ ...ok, rules: [] })).toContain("at least one rule");
  });

  it("requires a substantive reason", () => {
    expect(overrideBlockedReason({ ...ok, reason: "emergency" })).toContain(
      String(MIN_OVERRIDE_REASON_LENGTH),
    );
    // Whitespace padding must not be able to buy the length.
    expect(overrideBlockedReason({ ...ok, reason: "  short  " })).not.toBeNull();
  });

  it("accepts a reason exactly at the boundary", () => {
    expect(
      overrideBlockedReason({ ...ok, reason: "x".repeat(MIN_OVERRIDE_REASON_LENGTH) }),
    ).toBeNull();
    expect(
      overrideBlockedReason({ ...ok, reason: "x".repeat(MIN_OVERRIDE_REASON_LENGTH - 1) }),
    ).not.toBeNull();
  });

  it("requires the legal-risk acknowledgement", () => {
    expect(overrideBlockedReason({ ...ok, acknowledged: false })).toContain("legal risk");
  });

  it("matches the database's own minimum, so the UI never submits a doomed override", () => {
    expect(MIN_OVERRIDE_REASON_LENGTH).toBe(20);
  });
});

describe("the exposure shown to the person signing off", () => {
  it("names a concrete consequence for every overridable rule", () => {
    for (const rule of OVERRIDABLE_RULES) {
      expect(RULE_LABEL[rule]).toBeTruthy();
      expect(RULE_EXPOSURE[rule].length).toBeGreaterThan(30);
    }
  });

  it("describes each selected rule", () => {
    expect(describeExposure(["weekly_rest", "weekly_hours"])).toEqual([
      RULE_EXPOSURE.weekly_rest,
      RULE_EXPOSURE.weekly_hours,
    ]);
  });

  it("recognises exactly the rules the database allows", () => {
    expect([...OVERRIDABLE_RULES]).toEqual([
      "weekly_hours",
      "weekly_rest",
      "night_to_day",
      "day_to_night",
      "monthly_hours",
    ]);
    expect(isOverridableRule("weekly_rest")).toBe(true);
    expect(isOverridableRule("nonsense")).toBe(false);
  });
});
