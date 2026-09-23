// UAT-09 — the client side of the emergency rostering override.
//
// Decision §5 of DECISIONS-2026-09-03.md: limits hard-block on every write path; an admin may
// record an override carrying a mandatory reason and an explicit legal-risk acknowledgement.
// Nothing here bypasses anything on its own — the database is the enforcement point. This
// module only reads a refusal and describes what an admin would be taking responsibility for.

/** The rules an override may authorise. Mirrors the CHECK constraint on
 *  roster_emergency_overrides.rules — keep the two in step. */
export const OVERRIDABLE_RULES = [
  "weekly_hours",
  "weekly_rest",
  "night_to_day",
  "day_to_night",
  "monthly_hours",
] as const;

export type OverridableRule = (typeof OVERRIDABLE_RULES)[number];

export const RULE_LABEL: Record<OverridableRule, string> = {
  weekly_hours: "Weekly hour cap (60 hours)",
  weekly_rest: "Weekly rest — one full day off",
  night_to_day: "Rest between shifts — Night then Day",
  day_to_night: "Rest between shifts — Day then Night",
  monthly_hours: "Monthly hour cap",
};

/** What the admin is actually accepting responsibility for, per rule. Deliberately concrete:
 *  "acknowledge the legal risk" means nothing if nobody says what the risk is. */
export const RULE_EXPOSURE: Record<OverridableRule, string> = {
  weekly_hours:
    "Labour Act s.17 limits ordinary hours; exceeding the cap can make the extra hours unlawful rather than merely overtime.",
  weekly_rest:
    "Labour Act s.19 requires a weekly rest period. Working a guard seven days denies it.",
  night_to_day:
    "Turning a guard around from a night shift to a day shift leaves too little rest between them.",
  day_to_night:
    "Sending a guard from a day shift into a night shift leaves too little rest between them.",
  monthly_hours:
    "The tenant's own monthly ceiling. Breaching it is a policy breach rather than a statutory one.",
};

export const MIN_OVERRIDE_REASON_LENGTH = 20;

export function isOverridableRule(value: string): value is OverridableRule {
  return (OVERRIDABLE_RULES as readonly string[]).includes(value);
}

export type RosterRefusal = {
  /** Rules the database refused on, and that an override could authorise. */
  rules: OverridableRule[];
  /** The human-readable refusal, straight from the database. */
  message: string;
  /** True when the refusal is structural (wrong shift type, duplicate shift) — no override
   *  can help, because overriding it would produce incoherent data rather than accepted risk. */
  overridable: boolean;
};

type Postgrestish = { message?: string | null; details?: string | null; code?: string | null };

/**
 * Reads a refusal raised by enforce_roster_assignment_integrity (or the monthly cap trigger).
 *
 * The rule keys come from the error's DETAIL, not from parsing the prose — the message is
 * written for a human and will be reworded; DETAIL is the contract.
 */
export function parseRosterRefusal(error: unknown): RosterRefusal | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Postgrestish;
  const message = typeof e.message === "string" ? e.message : "";
  if (!message) return null;

  const rules = (typeof e.details === "string" ? e.details : "")
    .split(",")
    .map((r) => r.trim())
    .filter(isOverridableRule);

  // A refusal we recognise but with no overridable rules attached is structural.
  const looksLikeRefusal =
    rules.length > 0 ||
    message.includes("Assignment refused") ||
    message.includes("already has a working shift") ||
    message.includes("must use a Day or Night shift type") ||
    message.includes("Minimum rest breached") ||
    message.includes("Monthly hour cap exceeded") ||
    message.includes("is on approved leave");
  if (!looksLikeRefusal) return null;

  return { rules, message, overridable: rules.length > 0 };
}

/** Only an admin may authorise one — record_roster_override enforces this too. */
export function canAuthoriseOverride(role: string | undefined | null): boolean {
  return role === "admin";
}

export type OverrideDraft = { reason: string; acknowledged: boolean; rules: OverridableRule[] };

/** Returns the reason the draft cannot be submitted yet, or null when it is ready. */
export function overrideBlockedReason(draft: OverrideDraft): string | null {
  if (!draft.rules.length) return "Select at least one rule to authorise.";
  if (draft.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH) {
    return `Give a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters — it is the audit trail.`;
  }
  if (!draft.acknowledged) return "You must acknowledge the legal risk.";
  return null;
}

export function describeExposure(rules: OverridableRule[]): string[] {
  return rules.map((r) => RULE_EXPOSURE[r]);
}
