// What entitles a Sunday to the reduced 1.5× rate (UAT 2026-08-20 decision #7).
//
// The Labour Act's default for Sunday work is 2×. The reduced 1.5× is an *agreed* rate, so
// it needs a basis on file. The client confirmed the basis is the standing consent already
// signed into the employment contract — payroll does not chase a fresh consent action for
// every individual Sunday shift, and this module never asks for one.
//
// The other half of that decision is the part that changes money: where the contract consent
// or its supporting record is missing, unsigned or unverifiable, the 1.5× is NOT applied.
// The calculation falls back to the statutory 2×, payroll still runs, and the reason travels
// with the payslip breakdown and the audit trail. Silently granting 1.5× with no basis on
// file is the exposure the client asked us to close.

export type SundayPayBasis =
  // Standing signed consent on file — the contractual 1.5× applies.
  | "contract_agreed_1_5x"
  // No verifiable basis for the reduced rate — statutory 2× default.
  | "statutory_default_2x";

// The employee fields the basis is read from. Kept to exactly the columns that already
// exist on `employees`; nothing new is collected for this.
export type SundayConsentEmployee = {
  id?: string;
  ordinarily_works_sundays?: boolean | null;
  // Dedicated signed Sunday agreement, when one was uploaded separately.
  sunday_agreement_url?: string | null;
  // Standing consent lives in the signed employment contract.
  contract_signed_at?: string | null;
  contract_signed_pdf_url?: string | null;
};

export type SundayConsentResult = {
  basis: SundayPayBasis;
  // True only when a signed record backing the reduced rate could actually be verified.
  consentVerified: boolean;
  // Which record carried the basis, for the audit trail.
  evidence: "sunday_agreement" | "signed_employment_contract" | "none";
  // Why the basis came out the way it did — surfaced on the payslip breakdown when the
  // fallback kicks in, so payroll can see what is missing and fix the record.
  reasons: string[];
};

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Decide the Sunday basis for one employee.
//
// A dedicated signed Sunday agreement stands on its own. Otherwise the standing contract
// consent counts when both halves are on file: the employee is marked as ordinarily working
// Sundays, and their employment contract is actually signed. Either half missing means the
// basis cannot be verified, so the statutory default applies.
export function evaluateSundayConsent(employee: SundayConsentEmployee): SundayConsentResult {
  if (present(employee.sunday_agreement_url)) {
    return {
      basis: "contract_agreed_1_5x",
      consentVerified: true,
      evidence: "sunday_agreement",
      reasons: ["Signed Sunday agreement on file"],
    };
  }

  const worksSundays = employee.ordinarily_works_sundays === true;
  const contractSigned = present(employee.contract_signed_at);
  if (worksSundays && contractSigned) {
    return {
      basis: "contract_agreed_1_5x",
      consentVerified: true,
      evidence: "signed_employment_contract",
      reasons: ["Standing Sunday consent in the signed employment contract"],
    };
  }

  const reasons: string[] = [];
  if (!worksSundays) {
    reasons.push("Employee is not recorded as ordinarily working Sundays");
  }
  if (!contractSigned) {
    reasons.push("No signed employment contract on file to carry the standing Sunday consent");
  }
  return {
    basis: "statutory_default_2x",
    consentVerified: false,
    evidence: "none",
    reasons,
  };
}

// The multiplier a rostered Sunday is paid at, given the basis and the tenant's constants.
export function sundayMultiplierForBasis(
  basis: SundayPayBasis,
  constants: { sunday_multiplier: number; sunday_agreed_multiplier: number },
): number {
  return basis === "contract_agreed_1_5x"
    ? constants.sunday_agreed_multiplier
    : constants.sunday_multiplier;
}

// One line for the payslip breakdown / compliance warnings when the fallback applied.
export function sundayFallbackWarning(
  result: SundayConsentResult,
  constants: { sunday_multiplier: number; sunday_agreed_multiplier: number },
): string | null {
  if (result.consentVerified) return null;
  const detail = result.reasons.length ? ` — ${result.reasons.join("; ")}` : "";
  return `Sunday consent could not be verified: paid at the statutory ${constants.sunday_multiplier}× default instead of the agreed ${constants.sunday_agreed_multiplier}×${detail}`;
}
