import type { Database, Tables } from "@/integrations/supabase/types";

export type LeaveType = Database["public"]["Enums"]["leave_type"];
export type LeaveStatus = Database["public"]["Enums"]["leave_request_status"];
export type CoverageStatus = Database["public"]["Enums"]["leave_coverage_status"];
export type LeavePolicy = Tables<"leave_policies">;

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  compassionate: "Compassionate leave",
  maternity: "Maternity leave",
  unpaid: "Unpaid leave",
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function leaveStatusClass(status: LeaveStatus): string {
  if (status === "approved") return "bg-success/15 text-success border-success/30";
  if (status === "submitted") return "bg-warning/15 text-warning border-warning/40";
  if (status === "rejected") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground";
}

export function coverageStatusClass(status: CoverageStatus): string {
  if (status === "assigned") return "bg-success/15 text-success border-success/30";
  if (status === "open") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground";
}

export function dateSpanLabel(start: string, end: string): string {
  return start === end ? start : `${start} — ${end}`;
}

export function balanceFor(
  balance: { annual_days: number; sick_days: number; compassionate_days: number } | undefined,
  type: LeaveType,
): number | null {
  if (!balance || type === "unpaid" || type === "maternity")
    return type === "unpaid" || type === "maternity" ? null : 0;
  if (type === "annual") return Number(balance.annual_days);
  if (type === "sick") return Number(balance.sick_days);
  return Number(balance.compassionate_days);
}
