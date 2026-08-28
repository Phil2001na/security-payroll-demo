// Manual Sunday base rate, its validation, and the warning acknowledgement gate
// (UAT decisions #5 and #6).
import { describe, expect, test } from "bun:test";
import {
  SUNDAY_RATE_ACKNOWLEDGE_ROLES,
  acknowledgementCovers,
  canAcknowledgeSundayRateWarning,
  compareSundayBaseRate,
  sundayRateSubmissionBlock,
  validateSundayBaseRate,
  type SundayRateAcknowledgement,
} from "../src/lib/sunday-rate.ts";

const ORDINARY = 20;

const acknowledgement = (
  overrides: Partial<SundayRateAcknowledgement> = {},
): SundayRateAcknowledgement => ({
  acknowledgedBy: "user-payroll",
  acknowledgedByName: "P. Payroll",
  acknowledgedAt: "2026-08-28T10:15:00Z",
  acknowledgedRate: 25,
  acknowledgedOrdinaryRate: ORDINARY,
  reason: "Negotiated Sunday base for August, per client instruction.",
  ...overrides,
});

describe("entered Sunday rate matching the calculated ordinary rate", () => {
  test("an exact match needs no acknowledgement", () => {
    const comparison = compareSundayBaseRate({
      enteredRate: ORDINARY,
      calculatedOrdinaryRate: ORDINARY,
    });
    expect(comparison.status).toBe("match");
    expect(comparison.difference).toBe(0);
    expect(comparison.requiresAcknowledgement).toBe(false);
    expect(sundayRateSubmissionBlock({ comparison, acknowledgement: null })).toBeNull();
  });

  test("float dust below half a cent is a match, not a difference", () => {
    const comparison = compareSundayBaseRate({
      enteredRate: 20.001,
      calculatedOrdinaryRate: ORDINARY,
    });
    expect(comparison.status).toBe("match");
  });

  test("a rate of zero is a legitimate entry, not an invalid one", () => {
    const comparison = compareSundayBaseRate({ enteredRate: 0, calculatedOrdinaryRate: 0 });
    expect(comparison.status).toBe("match");
  });
});

describe("entered Sunday rate differing from the calculated ordinary rate", () => {
  const comparison = compareSundayBaseRate({ enteredRate: 25, calculatedOrdinaryRate: ORDINARY });

  test("the difference is identified in both money and percent", () => {
    expect(comparison.status).toBe("variance");
    expect(comparison.difference).toBe(5);
    expect(comparison.differencePercent).toBe(25);
    expect(comparison.message).toContain("N$25.00");
    expect(comparison.message).toContain("N$5.00");
    expect(comparison.message).toContain("above");
    expect(comparison.message).toContain("N$20.00");
  });

  test("a rate below the ordinary rate reports a negative difference", () => {
    const below = compareSundayBaseRate({ enteredRate: 18, calculatedOrdinaryRate: ORDINARY });
    expect(below.difference).toBe(-2);
    expect(below.message).toContain("below");
  });

  test("a difference alone never blocks — only the missing acknowledgement does", () => {
    // Decision #5: the workflow continues. Decision #6: it continues once acknowledged.
    const blocked = sundayRateSubmissionBlock({ comparison, acknowledgement: null });
    expect(blocked).not.toBeNull();
    expect(blocked).toContain("must acknowledge");
    expect(
      sundayRateSubmissionBlock({ comparison, acknowledgement: acknowledgement() }),
    ).toBeNull();
  });

  test("an unusable entry is rejected as invalid rather than treated as a difference", () => {
    for (const bad of [null, undefined, Number.NaN, -1]) {
      const invalid = compareSundayBaseRate({
        enteredRate: bad as number,
        calculatedOrdinaryRate: ORDINARY,
      });
      expect(invalid.status).toBe("invalid");
      expect(invalid.requiresAcknowledgement).toBe(false);
      // Nothing to hold: there is no rate on file yet.
      expect(sundayRateSubmissionBlock({ comparison: invalid, acknowledgement: null })).toBeNull();
    }
  });

  test("no rate entered at all leaves the period unblocked", () => {
    expect(sundayRateSubmissionBlock({ comparison: null, acknowledgement: null })).toBeNull();
  });
});

describe("validation across every employee's calculated ordinary rate", () => {
  const rates = [
    { employeeId: "e1", employeeName: "Nangolo, Petrus", ordinaryRate: 20 },
    { employeeId: "e2", employeeName: "Amadhila, Selma", ordinaryRate: 20 },
    { employeeId: "e3", employeeName: "Kandjii, Johannes", ordinaryRate: 24 },
  ];

  test("the headline compares against the most common ordinary rate", () => {
    const result = validateSundayBaseRate({ enteredRate: 20, ordinaryRates: rates });
    expect(result.calculatedOrdinaryRate).toBe(20);
    expect(result.distinctOrdinaryRates).toEqual([20, 24]);
    expect(result.matchedEmployeeCount).toBe(2);
    // Matching the majority is not enough — the outlier is still a difference on record.
    expect(result.status).toBe("variance");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].employeeName).toBe("Kandjii, Johannes");
    expect(result.mismatches[0].difference).toBe(-4);
    expect(result.message).toContain("differs for 1 employee");
  });

  test("a rate matching everyone is a clean match", () => {
    const result = validateSundayBaseRate({
      enteredRate: 20,
      ordinaryRates: rates.slice(0, 2),
    });
    expect(result.status).toBe("match");
    expect(result.mismatches).toEqual([]);
    expect(result.requiresAcknowledgement).toBe(false);
  });

  test("a rate matching nobody lists every employee it differs from", () => {
    const result = validateSundayBaseRate({ enteredRate: 30, ordinaryRates: rates });
    expect(result.status).toBe("variance");
    expect(result.mismatches).toHaveLength(3);
    expect(result.matchedEmployeeCount).toBe(0);
  });

  test("an empty period validates against zero rather than throwing", () => {
    const result = validateSundayBaseRate({ enteredRate: 20, ordinaryRates: [] });
    expect(result.calculatedOrdinaryRate).toBe(0);
    expect(result.status).toBe("variance");
  });
});

describe("warning acknowledgement (decision #6)", () => {
  const comparison = compareSundayBaseRate({ enteredRate: 25, calculatedOrdinaryRate: ORDINARY });

  test("an authorised user may acknowledge", () => {
    expect(SUNDAY_RATE_ACKNOWLEDGE_ROLES).toEqual(["payroll", "admin"]);
    expect(canAcknowledgeSundayRateWarning("payroll")).toBe(true);
    expect(canAcknowledgeSundayRateWarning("admin")).toBe(true);
  });

  test("an unauthorised user may not acknowledge on payroll's behalf", () => {
    for (const role of [
      "viewer",
      "operations",
      "supervisor",
      "security_supervisor",
      "accountant",
      "ceo",
      "",
      null,
      undefined,
    ]) {
      expect(canAcknowledgeSundayRateWarning(role)).toBe(false);
    }
  });

  test("the acknowledgement record carries user, timestamp, values and reason", () => {
    const record = acknowledgement();
    expect(record.acknowledgedBy).toBe("user-payroll");
    expect(record.acknowledgedAt).toBe("2026-08-28T10:15:00Z");
    expect(record.acknowledgedRate).toBe(25);
    expect(record.acknowledgedOrdinaryRate).toBe(ORDINARY);
    expect(record.reason).toContain("Negotiated Sunday base");
    expect(acknowledgementCovers(record, comparison)).toBe(true);
  });

  test("an acknowledgement with no actor or no timestamp does not count", () => {
    expect(acknowledgementCovers(acknowledgement({ acknowledgedBy: null }), comparison)).toBe(
      false,
    );
    expect(acknowledgementCovers(acknowledgement({ acknowledgedAt: null }), comparison)).toBe(
      false,
    );
    expect(acknowledgementCovers(null, comparison)).toBe(false);
  });

  test("editing the rate after acknowledging re-opens the warning", () => {
    const edited = compareSundayBaseRate({ enteredRate: 27, calculatedOrdinaryRate: ORDINARY });
    expect(acknowledgementCovers(acknowledgement(), edited)).toBe(false);
    expect(
      sundayRateSubmissionBlock({ comparison: edited, acknowledgement: acknowledgement() }),
    ).toContain("must acknowledge");
  });

  test("a changed ordinary rate also re-opens the warning", () => {
    const recalculated = compareSundayBaseRate({ enteredRate: 25, calculatedOrdinaryRate: 22 });
    expect(acknowledgementCovers(acknowledgement(), recalculated)).toBe(false);
  });

  test("an acknowledgement is not needed where the rates match", () => {
    const matching = compareSundayBaseRate({ enteredRate: 20, calculatedOrdinaryRate: ORDINARY });
    expect(sundayRateSubmissionBlock({ comparison: matching, acknowledgement: null })).toBeNull();
  });
});
