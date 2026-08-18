// Shared helpers for disciplinary actions — used by the Disciplinary page, the payroll
// verification flags and the per-guard history on the employee profile.
import { supabase } from "@/integrations/supabase/client";

export type DisciplinaryActionType =
  | "verbal_warning"
  | "written_warning"
  | "final_warning"
  | "unpaid_suspension"
  | "fine_with_ca"
  | "dismissal";

export const OFFENCES = [
  "Sleeping on duty", "Late arrival", "Absent without leave",
  "Unprofessional conduct", "Uniform violation", "Insubordination",
  "Theft / dishonesty", "Neglect of duty", "Other",
];

// Reasons a guard can be marked not present. Picked from this list or typed free-hand —
// either way a reason is mandatory, it lands on the shift log and payroll reads it when
// verifying the run.
export const ABSENCE_REASONS = [
  "No-show, no contact",
  "Called in sick",
  "Absent without leave (AWOL)",
  "Sent home by supervisor",
  "Family emergency / compassionate",
  "Suspended pending investigation",
  "Arrived too late to work the shift",
  "Other (specify)",
];

export const ABSENCE_REASON_OTHER = "Other (specify)";

// Absences with a legitimate explanation. Anything else counts toward the repeat-offender
// prompt on the muster (a supervisor still has to file the warning — we never auto-create
// disciplinary records, since a warning is an act the guard must be told about).
const EXCUSED_ABSENCE_REASONS = [
  "Called in sick",
  "Family emergency / compassionate",
  "Suspended pending investigation",
];

export function isUnexcusedAbsence(notes: string | null | undefined): boolean {
  if (!notes) return true; // no reason recorded (legacy rows) — treat as unexcused
  return !EXCUSED_ABSENCE_REASONS.some((r) => notes.includes(r));
}

// What a field supervisor may file straight from the muster — warnings only, no money.
// Mirrors disciplinary_actions_role_insert (20260719120000).
export const SUPERVISOR_ACTION_TYPES = ["verbal_warning", "written_warning", "final_warning"] as const;

export const DISCIPLINARY_ACTION_LABELS: Record<string, string> = {
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  final_warning: "Final warning",
  unpaid_suspension: "Unpaid suspension",
  fine_with_ca: "Fine",
  dismissal: "Dismissal",
};

export function disciplinaryActionLabel(type: string): string {
  return DISCIPLINARY_ACTION_LABELS[type] ?? type.replace(/_/g, " ");
}

// Actions that move money (or hours) on the payslip — payroll has to see these before
// confirming a run; the rest are informational.
export function affectsPay(action: { action_type: string; fine_amount?: number | null; suspension_hours?: number | null }): boolean {
  return (
    (action.action_type === "fine_with_ca" && Number(action.fine_amount || 0) > 0) ||
    (action.action_type === "unpaid_suspension" && Number(action.suspension_hours || 0) > 0)
  );
}

export function disciplinaryBadgeClass(type: string): string {
  if (type === "dismissal" || type === "final_warning") return "bg-destructive/15 text-destructive border-destructive/40";
  if (type === "unpaid_suspension" || type === "fine_with_ca") return "bg-warning/15 text-warning border-warning/40";
  return "";
}

export type RecorderProfile = { full_name: string; role: string };

// disciplinary_actions.created_by has no FK to profiles, so PostgREST can't embed it —
// resolve the names in a second query and hand back a lookup map.
export async function fetchRecorderProfiles(
  ids: (string | null | undefined)[],
): Promise<Map<string, RecorderProfile>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role")
    .in("id", unique);
  if (error) throw error;
  return new Map((data ?? []).map((p: any) => [p.id, { full_name: p.full_name, role: p.role as string }]));
}

export function recordedByLabel(recorder?: RecorderProfile | null): string {
  if (!recorder) return "unknown user";
  const name = recorder.full_name?.trim() || "unnamed user";
  return recorder.role ? `${name} (${recorder.role.replace(/_/g, " ")})` : name;
}
