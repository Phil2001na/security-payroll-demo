// The record → verify → confirm chain shared by disciplinary actions and employment exits.
// One person can never fill two of the three roles; that's enforced in the DB (check
// constraints + the transition RPCs), and mirrored here so the UI disables the buttons
// instead of letting the user hit an error.

export type ApprovalStatus = "recorded" | "verified" | "confirmed" | "cancelled";

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  recorded: "Recorded",
  verified: "Verified",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export function approvalBadgeClass(status: ApprovalStatus): string {
  switch (status) {
    case "confirmed": return "bg-success/15 text-success border-success/30";
    case "verified": return "bg-primary/15 text-primary border-primary/30";
    case "cancelled": return "bg-muted text-muted-foreground";
    default: return "bg-warning/15 text-warning border-warning/40";
  }
}

export const EXIT_TYPE_LABELS: Record<string, string> = {
  dismissal: "Dismissal",
  resignation: "Resignation",
  end_of_contract: "End of contract",
  abscondment: "Abscondment",
};

// Mirrors verify_disciplinary_action / verify_employment_exit.
export const VERIFIER_ROLES_DISCIPLINARY = ["admin", "operations", "supervisor", "payroll"];
export const VERIFIER_ROLES_EXIT = ["admin", "operations", "payroll"];
export const CONFIRMER_ROLES_DISCIPLINARY = ["admin", "operations", "payroll"];
export const CONFIRMER_ROLES_EXIT = ["admin", "operations"];

type Chain = { status: ApprovalStatus; recorded_by?: string | null; verified_by?: string | null };

export function canVerify(row: Chain, userId: string | undefined, role: string | undefined, roles: string[]): boolean {
  return (
    row.status === "recorded" &&
    !!userId && !!role && roles.includes(role) &&
    row.recorded_by !== userId
  );
}

export function canConfirm(
  row: Chain & { exit_type?: string },
  userId: string | undefined,
  role: string | undefined,
  roles: string[],
  { requiresVerification = true }: { requiresVerification?: boolean } = {},
): boolean {
  if (!userId || !role || !roles.includes(role)) return false;
  if (row.status === "confirmed" || row.status === "cancelled") return false;
  if (requiresVerification && row.status !== "verified") return false;
  if (row.recorded_by === userId) return false;
  if (row.verified_by === userId) return false;
  return true;
}

// Dismissals and abscondments need the middle step; a resignation or contract end only
// needs a second pair of eyes on the confirm. Mirrors confirm_employment_exit.
export function exitRequiresVerification(exitType: string): boolean {
  return exitType === "dismissal" || exitType === "abscondment";
}
