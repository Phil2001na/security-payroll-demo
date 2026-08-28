// Manually entered Sunday base rate, its validation and its warning acknowledgement
// (UAT 2026-08-20 decisions #5 and #6).
//
// Payroll enters the Sunday base rate for a pay period. The system checks it against the
// ordinary rate it calculated for that period and, where the two differ, says so plainly:
// what was entered, what was calculated, and by how much they part company.
//
// The two decisions read together and the split matters:
//   #5 a difference NEVER blocks submission on its own — payroll's authorised workflow
//      continues, because the entered rate can legitimately differ (a negotiated Sunday
//      base, a correction, a rate change mid-period);
//   #6 what does gate submission is an UNACKNOWLEDGED warning. An authorised user has to
//      look at the difference and take it on the record first. Any authorised user clears
//      it immediately; nobody else can clear it on payroll's behalf.

import { round2 } from "./payroll-engine.ts";

// Who may take a Sunday-rate warning on the record. Mirrors
// `acknowledge_sunday_rate_variance` in the migration — the database is the real gate; this
// is here so the UI disables the button instead of firing a call that will be rejected.
export const SUNDAY_RATE_ACKNOWLEDGE_ROLES = ["payroll", "admin"] as const;

// Rates are money, so equality is to the cent. Anything under half a cent is float noise
// from the rate calculation, not a difference a human entered.
export const RATE_TOLERANCE = 0.005;

export type SundayRateComparisonStatus =
  | "match" // entered rate equals the calculated ordinary rate
  | "variance" // differs — warn, identify the difference, allow the workflow to continue
  | "invalid"; // not a usable rate at all (missing, non-numeric, negative)

export type SundayRateComparison = {
  status: SundayRateComparisonStatus;
  enteredRate: number | null;
  calculatedOrdinaryRate: number;
  // Signed: positive when the entered rate is above the calculated ordinary rate.
  difference: number;
  differencePercent: number;
  requiresAcknowledgement: boolean;
  message: string;
};

// Compare one entered Sunday base rate against one calculated ordinary rate.
export function compareSundayBaseRate(args: {
  enteredRate: number | null | undefined;
  calculatedOrdinaryRate: number;
  tolerance?: number;
}): SundayRateComparison {
  const tolerance = args.tolerance ?? RATE_TOLERANCE;
  const calculated = round2(Number(args.calculatedOrdinaryRate) || 0);
  const raw = args.enteredRate;
  const entered = raw === null || raw === undefined || raw === ("" as unknown) ? NaN : Number(raw);

  if (!Number.isFinite(entered) || entered < 0) {
    return {
      status: "invalid",
      enteredRate: null,
      calculatedOrdinaryRate: calculated,
      difference: 0,
      differencePercent: 0,
      // An unusable entry is not a "difference to acknowledge" — there is nothing to take
      // on the record until a real rate is entered.
      requiresAcknowledgement: false,
      message: "Enter a Sunday base rate of zero or more.",
    };
  }

  const rounded = round2(entered);
  const difference = round2(rounded - calculated);
  if (Math.abs(difference) < tolerance) {
    return {
      status: "match",
      enteredRate: rounded,
      calculatedOrdinaryRate: calculated,
      difference: 0,
      differencePercent: 0,
      requiresAcknowledgement: false,
      message: `Sunday base rate N$${rounded.toFixed(2)} matches the calculated ordinary rate.`,
    };
  }

  const differencePercent = calculated > 0 ? round2((difference / calculated) * 100) : 0;
  const direction = difference > 0 ? "above" : "below";
  return {
    status: "variance",
    enteredRate: rounded,
    calculatedOrdinaryRate: calculated,
    difference,
    differencePercent,
    requiresAcknowledgement: true,
    message:
      `Sunday base rate N$${rounded.toFixed(2)} is N$${Math.abs(difference).toFixed(2)} ` +
      `(${Math.abs(differencePercent).toFixed(2)}%) ${direction} the calculated ordinary rate ` +
      `N$${calculated.toFixed(2)}.`,
  };
}

export type OrdinaryRateSample = {
  employeeId: string;
  employeeName: string;
  ordinaryRate: number;
};

export type SundayRateValidation = SundayRateComparison & {
  // Every distinct calculated ordinary rate in the period, ascending. More than one is the
  // normal case only where guards are on different rates.
  distinctOrdinaryRates: number[];
  // Employees whose calculated ordinary rate differs from the entered Sunday base rate.
  mismatches: Array<OrdinaryRateSample & { difference: number; differencePercent: number }>;
  matchedEmployeeCount: number;
};

// Validate the period's entered Sunday base rate against every employee's calculated
// ordinary rate. The headline comparison uses the most common calculated rate, so a single
// outlier employee doesn't redefine what "the ordinary rate" is for the period.
export function validateSundayBaseRate(args: {
  enteredRate: number | null | undefined;
  ordinaryRates: OrdinaryRateSample[];
  tolerance?: number;
}): SundayRateValidation {
  const tolerance = args.tolerance ?? RATE_TOLERANCE;
  const samples = args.ordinaryRates.filter((s) => Number.isFinite(Number(s.ordinaryRate)));

  const counts = new Map<number, number>();
  for (const sample of samples) {
    const rate = round2(Number(sample.ordinaryRate));
    counts.set(rate, (counts.get(rate) ?? 0) + 1);
  }
  const distinctOrdinaryRates = [...counts.keys()].sort((a, b) => a - b);
  // Most frequent wins; on a tie the lower rate wins, so the comparison never flatters the
  // entry by silently picking the highest rate in the period.
  let modalRate = 0;
  let modalCount = -1;
  for (const rate of distinctOrdinaryRates) {
    const count = counts.get(rate) ?? 0;
    if (count > modalCount) {
      modalCount = count;
      modalRate = rate;
    }
  }

  const headline = compareSundayBaseRate({
    enteredRate: args.enteredRate,
    calculatedOrdinaryRate: modalRate,
    tolerance,
  });

  const mismatches: SundayRateValidation["mismatches"] = [];
  let matchedEmployeeCount = 0;
  if (headline.enteredRate !== null) {
    for (const sample of samples) {
      const rate = round2(Number(sample.ordinaryRate));
      const difference = round2(headline.enteredRate - rate);
      if (Math.abs(difference) < tolerance) {
        matchedEmployeeCount += 1;
        continue;
      }
      mismatches.push({
        employeeId: sample.employeeId,
        employeeName: sample.employeeName,
        ordinaryRate: rate,
        difference,
        differencePercent: rate > 0 ? round2((difference / rate) * 100) : 0,
      });
    }
  }

  // A rate that matches the modal employee but not everyone else is still a difference
  // someone has to take on the record.
  const status: SundayRateComparisonStatus =
    headline.status === "match" && mismatches.length > 0 ? "variance" : headline.status;

  return {
    ...headline,
    status,
    requiresAcknowledgement: status === "variance",
    message:
      status === "variance" && headline.status === "match"
        ? `Sunday base rate N$${headline.enteredRate?.toFixed(2)} matches the most common ordinary rate but differs for ${mismatches.length} employee${mismatches.length === 1 ? "" : "s"}.`
        : headline.message,
    distinctOrdinaryRates,
    mismatches,
    matchedEmployeeCount,
  };
}

// ── Acknowledgement (decision #6) ────────────────────────────────────────────

export type SundayRateAcknowledgement = {
  acknowledgedBy: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt: string | null;
  // The values as they stood when the warning was taken on the record. Re-entering a
  // different rate invalidates the acknowledgement — see acknowledgementCovers below.
  acknowledgedRate: number | null;
  acknowledgedOrdinaryRate: number | null;
  reason?: string | null;
};

export function canAcknowledgeSundayRateWarning(role: string | null | undefined): boolean {
  return !!role && (SUNDAY_RATE_ACKNOWLEDGE_ROLES as readonly string[]).includes(role);
}

// An acknowledgement only covers the exact pair of values it was given for. If payroll
// edits the Sunday base rate afterwards, the old acknowledgement no longer stands and the
// new difference has to be taken on the record again.
export function acknowledgementCovers(
  acknowledgement: SundayRateAcknowledgement | null | undefined,
  comparison: SundayRateComparison,
  tolerance = RATE_TOLERANCE,
): boolean {
  if (!acknowledgement?.acknowledgedBy || !acknowledgement.acknowledgedAt) return false;
  if (comparison.enteredRate === null) return false;
  return (
    Math.abs((acknowledgement.acknowledgedRate ?? NaN) - comparison.enteredRate) < tolerance &&
    Math.abs(
      (acknowledgement.acknowledgedOrdinaryRate ?? NaN) - comparison.calculatedOrdinaryRate,
    ) < tolerance
  );
}

// Why payroll submission is being held, or null when it may proceed.
//
// Note what is NOT here: a difference between the entered and calculated rate is never on
// its own a reason to stop (decision #5). The only hold is the missing acknowledgement
// (decision #6), and any authorised user clears it.
export function sundayRateSubmissionBlock(args: {
  comparison: SundayRateComparison | null;
  acknowledgement: SundayRateAcknowledgement | null | undefined;
}): string | null {
  const { comparison, acknowledgement } = args;
  // No Sunday base rate entered for the period — nothing to validate, nothing to hold.
  if (!comparison || comparison.status === "invalid") return null;
  if (!comparison.requiresAcknowledgement) return null;
  if (acknowledgementCovers(acknowledgement, comparison)) return null;
  return `${comparison.message} An authorised payroll user must acknowledge this difference before the period can be submitted.`;
}
