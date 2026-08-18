// Monthly hour ceilings (tracker #7). One definition, used by Attendance and Schedule, so
// the two screens can't disagree about how close a guard is to their limit. The hard stop
// lives in the database (enforce_monthly_hour_cap trigger) for the same reason the 12h daily
// cap does — it has to hold no matter what writes the row.
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_MONTHLY_HOUR_CAP = 240;
export const DEFAULT_MONTHLY_OVERTIME_CAP = 20;

export type HourCaps = {
  monthlyHours: number;
  monthlyOvertime: number;
  // 0 = warn only, 1 = the database rejects the write. Warn is the default: the client's
  // current 6×12h rosters already run past 240h, so switching this on changes how they
  // roster and is a decision for them, not a default we impose.
  enforce: boolean;
};

export async function fetchHourCaps(): Promise<HourCaps> {
  const { data } = await supabase
    .from("payroll_constants")
    .select("key,value")
    .in("key", ["monthly_hour_cap", "monthly_overtime_cap", "monthly_cap_enforced"]);
  const map = new Map((data ?? []).map((r: any) => [r.key, Number(r.value)]));
  return {
    monthlyHours: map.get("monthly_hour_cap") ?? DEFAULT_MONTHLY_HOUR_CAP,
    monthlyOvertime: map.get("monthly_overtime_cap") ?? DEFAULT_MONTHLY_OVERTIME_CAP,
    enforce: (map.get("monthly_cap_enforced") ?? 0) === 1,
  };
}

// Calendar-month bounds for a YYYY-MM-DD date, timezone-independent.
export function monthBounds(date: string): { start: string; end: string } {
  const [y, m] = date.slice(0, 10).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Hours already logged (approved or awaiting approval — both will count once approved)
// per employee for the calendar month containing `date`.
export async function fetchMonthlyHours(date: string): Promise<Map<string, number>> {
  const { start, end } = monthBounds(date);
  const { data, error } = await supabase
    .from("shift_logs")
    .select("employee_id,hours_worked,status")
    .gte("date", start)
    .lte("date", end);
  if (error) throw error;
  const m = new Map<string, number>();
  for (const l of (data ?? []) as any[]) {
    if (l.status === "no_show" || l.status === "replaced_by_other") continue;
    m.set(l.employee_id, (m.get(l.employee_id) ?? 0) + Number(l.hours_worked || 0));
  }
  return m;
}

export type CapStatus = "ok" | "approaching" | "over";

// "Approaching" starts at 90% — far enough out that a scheduler can still do something
// about it, which is the only point of warning at all.
export function capStatus(hours: number, cap: number, adding = 0): CapStatus {
  const total = hours + adding;
  if (total > cap) return "over";
  if (total >= cap * 0.9) return "approaching";
  return "ok";
}

export const CAP_STATUS_CLASS: Record<CapStatus, string> = {
  ok: "",
  approaching: "text-warning font-medium",
  over: "text-destructive font-bold",
};
