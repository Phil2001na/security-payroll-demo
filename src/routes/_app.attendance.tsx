import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Loader2, Search, UserPlus, ShieldAlert, ShieldCheck, Save, Users,
  Minus, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  OFFENCES, SUPERVISOR_ACTION_TYPES, disciplinaryActionLabel,
  ABSENCE_REASONS, ABSENCE_REASON_OTHER, isUnexcusedAbsence,
} from "@/lib/disciplinary";
import {
  fetchHourCaps, fetchMonthlyHours, capStatus, CAP_STATUS_CLASS, type HourCaps,
} from "@/lib/hour-caps";

export const Route = createFileRoute("/_app/attendance")({
  component: AttendancePage,
  head: () => ({ meta: [{ title: "Daily Muster — Demo Payroll System" }] }),
});

const WEEKLY_HOUR_CAP = 60;

type Site = { id: string; name: string; code: string | null };
type ShiftType = { id: string; code: string; label: string; default_hours: number; period: string };
type Employee = {
  id: string; employee_code: string; surname: string; first_names: string;
  home_site_id: string | null; status: string;
};
type Assignment = {
  id: string; employee_id: string; site_id: string; date: string;
  shift_type_id: string; planned_hours: number;
  is_replacement: boolean; replaced_assignment_id: string | null;
};
type ShiftLog = {
  id: string; employee_id: string; site_id: string; date: string;
  shift_type_id: string; pay_period_id: string; assignment_id: string | null;
  hours_worked: number; night_hours: number;
  status: "pending" | "submitted" | "approved" | "no_show" | "replaced_by_other" | "suspended_unpaid";
  notes: string | null;
};
type PayPeriod = { id: string; start_date: string; end_date: string; label: string };

function fmtIso(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isoWeekStart(d: Date) {
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (tmp.getDay() + 6) % 7;
  tmp.setDate(tmp.getDate() - dayNum);
  return tmp;
}

function AttendancePage() {
  const { profile } = useAuth();
  const role = profile?.role;
  if (role && role !== "admin" && role !== "operations" && role !== "supervisor" && role !== "payroll" && role !== "security_supervisor") {
    return <AccessDenied message="Attendance access is restricted to payroll and operations staff." />;
  }
  // Security supervisors mark attendance but cannot replace guards, are scoped to
  // their assigned sites, and their marks are submitted for payroll approval.
  const isSecuritySupervisor = role === "security_supervisor";
  const canReplace = !isSecuritySupervisor;
  const allowedSiteIds = profile?.assigned_site_ids ?? [];
  const qc = useQueryClient();
  const [date, setDate] = useState(() => fmtIso(new Date()));
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Pending status changes by assignment.id
  const [pending, setPending] = useState<Record<string, { status: ShiftLog["status"]; notes?: string }>>({});
  const [replaceFor, setReplaceFor] = useState<Assignment | null>(null);
  const [deductFor, setDeductFor] = useState<Assignment | null>(null);
  const [deductTypeId, setDeductTypeId] = useState<string>("");
  const [deductAmount, setDeductAmount] = useState<string>("");
  const [deductNote, setDeductNote] = useState<string>("");
  // Offence flag raised straight off the muster row (e.g. caught sleeping on duty). Files a
  // warning-level disciplinary_action, which payroll then sees on the guard's payroll row.
  const [flagFor, setFlagFor] = useState<Assignment | null>(null);
  const [flagOffence, setFlagOffence] = useState<string>(OFFENCES[0]);
  const [flagActionType, setFlagActionType] =
    useState<(typeof SUPERVISOR_ACTION_TYPES)[number]>("written_warning");
  const [flagNote, setFlagNote] = useState("");
  // Marking a guard not present always needs a reason — picked from the list or typed.
  const [absentFor, setAbsentFor] = useState<Assignment | null>(null);
  const [absentReason, setAbsentReason] = useState<string>(ABSENCE_REASONS[0]);
  const [absentNote, setAbsentNote] = useState("");
  const [overrideCap, setOverrideCap] = useState(false);
  const [saving, setSaving] = useState(false);

  const dateObj = useMemo(() => new Date(date), [date]);
  const weekStart = fmtIso(isoWeekStart(dateObj));
  const weekEnd = fmtIso(new Date(isoWeekStart(dateObj).getTime() + 6 * 86400000));

  const { data: sites } = useQuery<Site[]>({
    queryKey: ["sites", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name, code").eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: shiftTypes } = useQuery<ShiftType[]>({
    queryKey: ["shift-types", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types").select("id, code, label, default_hours, period")
        .eq("active", true).order("code");
      if (error) throw error;
      return (data ?? []) as ShiftType[];
    },
  });

  const { data: deductionTypes } = useQuery({
    queryKey: ["deduction-types", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deduction_types")
        .select("id, code, label, category, default_amount, requires_collective_agreement, requires_evidence")
        .eq("active", true)
        .in("category", ["offence_fine", "loan", "other", "recurring"])
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: payPeriod } = useQuery<PayPeriod | null>({
    queryKey: ["pay-period-for", profile?.tenant_id, date],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .select("id, start_date, end_date, label")
        .lte("start_date", date).gte("end_date", date)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: assignments } = useQuery<Assignment[]>({
    queryKey: ["assignments-day", profile?.tenant_id, date],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours, is_replacement, replaced_assignment_id")
        .eq("date", date);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: dayLogs, refetch: refetchLogs } = useQuery<ShiftLog[]>({
    queryKey: ["shift-logs-day", profile?.tenant_id, date],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_logs")
        .select("id, employee_id, site_id, date, shift_type_id, pay_period_id, assignment_id, hours_worked, night_hours, status, notes")
        .eq("date", date);
      if (error) throw error;
      return (data ?? []) as ShiftLog[];
    },
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["employees-active", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, surname, first_names, home_site_id, status, contract_signed_at, category")
        .eq("status", "active");
      if (error) throw error;
      // Replacement candidates must have a signed contract (officers).
      return (data ?? []) as Employee[];
    },
  });

  // Week assignments to compute weekly hours for replacement candidates
  const { data: weekAssignments } = useQuery<Pick<Assignment, "id" | "employee_id" | "site_id" | "date" | "shift_type_id" | "planned_hours">[]>({
    queryKey: ["assignments-week", profile?.tenant_id, weekStart, weekEnd],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .gte("date", weekStart).lte("date", weekEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    (employees ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const siteById = useMemo(() => {
    const m = new Map<string, Site>();
    (sites ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [sites]);

  const shiftById = useMemo(() => {
    const m = new Map<string, ShiftType>();
    (shiftTypes ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [shiftTypes]);

  const logByAssignment = useMemo(() => {
    const m = new Map<string, ShiftLog>();
    (dayLogs ?? []).forEach((l) => { if (l.assignment_id) m.set(l.assignment_id, l); });
    return m;
  }, [dayLogs]);

  // Every unexcused absence already logged this pay period, per guard — drives the
  // "3rd AWOL this period" prompt on the row.
  const { data: periodNoShows } = useQuery({
    queryKey: ["period-no-shows", payPeriod?.id],
    enabled: !!payPeriod?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_logs")
        .select("employee_id, date, notes")
        .eq("pay_period_id", payPeriod!.id)
        .eq("status", "no_show")
        .order("date");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Monthly hour ceiling (#7). Measured here because this is where hours actually get
  // committed; the database enforces the same cap once the tenant switches it on.
  const { data: hourCaps } = useQuery<HourCaps>({
    queryKey: ["hour-caps", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: fetchHourCaps,
  });

  const { data: monthHoursByEmp } = useQuery({
    queryKey: ["monthly-hours", date.slice(0, 7)],
    enabled: !!profile?.tenant_id,
    queryFn: () => fetchMonthlyHours(date),
  });

  const unexcusedByEmp = useMemo(() => {
    const m = new Map<string, string[]>();
    (periodNoShows ?? []).forEach((l: { employee_id: string; date: string; notes: string | null }) => {
      if (!isUnexcusedAbsence(l.notes)) return;
      const arr = m.get(l.employee_id) ?? [];
      arr.push(l.date);
      m.set(l.employee_id, arr);
    });
    return m;
  }, [periodNoShows]);

  const assignmentById = useMemo(() => {
    const m = new Map<string, Assignment>();
    (assignments ?? []).forEach((a) => m.set(a.id, a));
    return m;
  }, [assignments]);

  // Reverse lookup: original assignment id -> the relief assignment covering it.
  const reliefByOriginal = useMemo(() => {
    const m = new Map<string, Assignment>();
    (assignments ?? []).forEach((a) => {
      if (a.is_replacement && a.replaced_assignment_id) m.set(a.replaced_assignment_id, a);
    });
    return m;
  }, [assignments]);

  // "Relief for X" on the reliever's row, "Replaced by Y" on the absent guard's row.
  function replacementNote(a: Assignment): string | null {
    if (a.is_replacement && a.replaced_assignment_id) {
      const orig = assignmentById.get(a.replaced_assignment_id);
      const origEmp = orig ? empById.get(orig.employee_id) : null;
      return origEmp ? `Relief for ${origEmp.surname}, ${origEmp.first_names}` : "Relief guard";
    }
    const relief = reliefByOriginal.get(a.id);
    if (relief) {
      const reliefEmp = empById.get(relief.employee_id);
      return reliefEmp ? `Replaced by ${reliefEmp.surname}, ${reliefEmp.first_names}` : "Replaced";
    }
    return null;
  }

  // Sites visible in the filter dropdown — security supervisors only see theirs.
  const scopedSites = useMemo(() => {
    if (!isSecuritySupervisor) return sites ?? [];
    return (sites ?? []).filter((s) => allowedSiteIds.includes(s.id));
  }, [sites, isSecuritySupervisor, allowedSiteIds]);

  // Filter assignments by site + search
  const visibleAssignments = useMemo(() => {
    let list = (assignments ?? []).slice();
    // Security supervisors are scoped to their assigned sites (DB RLS is tenant-wide).
    if (isSecuritySupervisor) list = list.filter((a) => allowedSiteIds.includes(a.site_id));
    if (siteFilter !== "all") list = list.filter((a) => a.site_id === siteFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => {
        const e = empById.get(a.employee_id);
        if (!e) return false;
        return e.surname.toLowerCase().includes(q) ||
          e.first_names.toLowerCase().includes(q) ||
          e.employee_code.toLowerCase().includes(q);
      });
    }
    // Group by site, then sort by surname
    list.sort((a, b) => {
      const sa = siteById.get(a.site_id)?.name ?? "";
      const sb = siteById.get(b.site_id)?.name ?? "";
      if (sa !== sb) return sa.localeCompare(sb);
      const ea = empById.get(a.employee_id);
      const eb = empById.get(b.employee_id);
      return (ea?.surname ?? "").localeCompare(eb?.surname ?? "");
    });
    return list;
  }, [assignments, siteFilter, search, empById, siteById, isSecuritySupervisor, allowedSiteIds]);

  // Weekly hours per employee (planned, from assignments)
  const weekHoursByEmp = useMemo(() => {
    const m = new Map<string, number>();
    (weekAssignments ?? []).forEach((a) => {
      m.set(a.employee_id, (m.get(a.employee_id) ?? 0) + Number(a.planned_hours));
    });
    return m;
  }, [weekAssignments]);

  function effectiveStatus(a: Assignment): ShiftLog["status"] {
    if (pending[a.id]) return pending[a.id].status;
    return logByAssignment.get(a.id)?.status ?? "pending";
  }

  function setStatus(a: Assignment, status: ShiftLog["status"]) {
    setPending((prev) => {
      const next = { ...prev };
      const existing = logByAssignment.get(a.id);
      if (existing && existing.status === status) {
        delete next[a.id]; // revert
      } else {
        next[a.id] = { ...next[a.id], status };
      }
      return next;
    });
  }

  // Absent is never a one-click state: it either opens the reason dialog, or (if this row
  // already has an unsaved absence pending) clears the mark again.
  function openAbsence(a: Assignment) {
    if (pending[a.id]) {
      setPending((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      return;
    }
    setAbsentFor(a);
    setAbsentReason(ABSENCE_REASONS[0]);
    setAbsentNote("");
  }

  function applyAbsence() {
    if (!absentFor) return;
    const isOther = absentReason === ABSENCE_REASON_OTHER;
    const detail = absentNote.trim();
    if (isOther && !detail) {
      toast.error("Type the reason this guard is not on duty.");
      return;
    }
    const notes = `Absent — ${isOther ? detail : absentReason}${!isOther && detail ? `: ${detail}` : ""}`;
    setPending((prev) => ({ ...prev, [absentFor.id]: { status: "no_show", notes } }));
    setAbsentFor(null);
    setAbsentNote("");
  }

  // Absence reason to show on the row — the unsaved one if there is one, else what's stored.
  function absenceNote(a: Assignment): string | null {
    const p = pending[a.id];
    if (p) return p.status === "no_show" ? p.notes ?? null : null;
    const log = logByAssignment.get(a.id);
    return log?.status === "no_show" ? log.notes : null;
  }

  function markAllPresent(list: Assignment[]) {
    const updates: Record<string, { status: ShiftLog["status"] }> = { ...pending };
    let changed = 0;
    list.forEach((a) => {
      const cur = effectiveStatus(a);
      if (cur === "pending") {
        updates[a.id] = { status: "approved" };
        changed++;
      }
    });
    setPending(updates);
    toast.success(`Marked ${changed} guard${changed === 1 ? "" : "s"} present`);
  }

  // Stats — computed per list so day and night can each report their own muster
  // instead of a single blended figure that hides one shift behind the other.
  function statsOf(list: Assignment[]) {
    let present = 0, absent = 0, replaced = 0, pendingC = 0;
    list.forEach((a) => {
      const s = effectiveStatus(a);
      if (s === "approved" || s === "submitted") present++;
      else if (s === "no_show") absent++;
      else if (s === "replaced_by_other") replaced++;
      else pendingC++;
    });
    return { tot: list.length, present, absent, replaced, pendingC };
  }

  const stats = useMemo(
    () => statsOf(visibleAssignments),
    [visibleAssignments, pending, logByAssignment],
  );

  // Guards whose pending "present" marks would carry them past the monthly ceiling. Shown
  // before Confirm, since that's the last moment anyone can do something about it.
  const capBreaches = useMemo(() => {
    const cap = hourCaps?.monthlyHours ?? 240;
    const out: Array<{ name: string; total: number }> = [];
    const addedByEmp = new Map<string, number>();
    for (const [assignmentId, change] of Object.entries(pending)) {
      if (change.status !== "approved") continue;
      const a = assignments?.find((x) => x.id === assignmentId);
      if (!a) continue;
      addedByEmp.set(a.employee_id, (addedByEmp.get(a.employee_id) ?? 0) + Number(a.planned_hours || 0));
    }
    for (const [empId, added] of addedByEmp) {
      const total = (monthHoursByEmp?.get(empId) ?? 0) + added;
      if (total > cap) {
        const e = empById.get(empId);
        out.push({ name: e ? `${e.surname}, ${e.first_names}` : empId, total });
      }
    }
    return out;
  }, [pending, assignments, monthHoursByEmp, hourCaps, empById]);

  // Day and night are confirmed separately, so every confirm is scoped to the rows of
  // one section — the pending map is shared, the write is not.
  function dirtyIn(list: Assignment[]) {
    return list.filter((a) => a.id in pending).length;
  }

  function discard(list: Assignment[]) {
    setPending((prev) => {
      const next = { ...prev };
      list.forEach((a) => delete next[a.id]);
      return next;
    });
  }

  async function confirm(scope: Assignment[]) {
    if (!profile?.tenant_id || !payPeriod) {
      toast.error("No open pay period for this date.");
      return;
    }
    const scopeIds = new Set(scope.map((a) => a.id));
    const scoped = Object.entries(pending).filter(([id]) => scopeIds.has(id));
    if (scoped.length === 0) return;
    setSaving(true);
    try {
      // Build per-assignment payloads
      const inserts: Array<Omit<ShiftLog, "id">> = [];
      const updates: Array<{ id: string; status: ShiftLog["status"]; hours_worked: number; notes: string | null }> = [];
      for (const [assignmentId, change] of scoped) {
        const a = assignments?.find((x) => x.id === assignmentId);
        if (!a) continue;
        const st = shiftById.get(a.shift_type_id);
        const hours = change.status === "approved" ? Number(a.planned_hours) : 0;
        // crude night detection: shift code ending in /NS or "Night"
        const nightHours = st && /night|N\/?S$/i.test(st.code + " " + st.label) && change.status === "approved" ? Number(a.planned_hours) : 0;
        // Security supervisors don't finalize — a "present" mark is submitted for
        // payroll to approve before it counts toward pay.
        const persistStatus: ShiftLog["status"] =
          isSecuritySupervisor && change.status === "approved" ? "submitted" : change.status;
        const existing = logByAssignment.get(a.id);
        if (existing) {
          updates.push({ id: existing.id, status: persistStatus, hours_worked: hours, notes: change.notes ?? existing.notes });
        } else {
          inserts.push({
            employee_id: a.employee_id,
            site_id: a.site_id,
            date: a.date,
            shift_type_id: a.shift_type_id,
            pay_period_id: payPeriod.id,
            assignment_id: a.id,
            hours_worked: hours,
            night_hours: nightHours,
            status: persistStatus,
            notes: change.notes ?? null,
          });
        }
      }
      if (inserts.length) {
        const payload = inserts.map((r) => ({ ...r, tenant_id: profile.tenant_id }));
        for (let i = 0; i < payload.length; i += 200) {
          const { error } = await supabase.from("shift_logs").insert(payload.slice(i, i + 200));
          if (error) throw error;
        }
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("shift_logs")
          .update({ status: u.status, hours_worked: u.hours_worked, notes: u.notes })
          .eq("id", u.id);
        if (error) throw error;
      }
      toast.success(`Attendance confirmed · ${scoped.length} record${scoped.length === 1 ? "" : "s"}`);
      setPending((prev) => {
        const next = { ...prev };
        for (const [id] of scoped) delete next[id];
        return next;
      });
      await refetchLogs();
      await qc.invalidateQueries({ queryKey: ["assignments-day"] });
      await qc.invalidateQueries({ queryKey: ["period-no-shows"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setSaving(false);
    }
  }

  // ----- Replacement logic -----
  // Return ALL off-duty candidates; flag those who would exceed 60h/week so HR
  // gets a warning before assigning them.
  const replacementCandidates = useMemo(() => {
    if (!replaceFor || !employees) return [];
    const assignedEmpIdsToday = new Set((assignments ?? []).map((a) => a.employee_id));
    const slotHours = Number(replaceFor.planned_hours);
    return employees
      .filter((e) => e.id !== replaceFor.employee_id)
      .filter((e) => !assignedEmpIdsToday.has(e.id)) // off-duty today
      .map((e) => {
        const wk = weekHoursByEmp.get(e.id) ?? 0;
        const wkAfter = wk + slotHours;
        return { emp: e, weekBefore: wk, weekAfter: wkAfter, overCap: wkAfter > WEEKLY_HOUR_CAP };
      })
      .sort((a, b) => {
        if (a.overCap !== b.overCap) return a.overCap ? 1 : -1;
        return a.weekAfter - b.weekAfter;
      })
      .slice(0, 40);
  }, [replaceFor, employees, assignments, weekHoursByEmp]);

  async function applyReplacement(reliefEmpId: string, overCap: boolean) {
    if (!canReplace) return; // security supervisors cannot replace guards
    if (!replaceFor || !profile?.tenant_id || !payPeriod) return;
    if (overCap) {
      const ok = window.confirm(
        "⚠️ This guard will exceed the 60-hour weekly cap.\n\nNamibian Labour Act limits weekly hours to 60h unless a PS exemption is on file. Proceeding without one may expose the company to penalties.\n\nContinue anyway?"
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const a = replaceFor;
      const reliefName = empById.get(reliefEmpId)?.surname ?? "relief guard";

      // 1. Mark the original assignment as replaced (distinct from a plain no_show,
      //    so it's visible who covered the shift) -> upsert log with 0 hours.
      const existingOriginalLog = logByAssignment.get(a.id);
      if (existingOriginalLog) {
        const { error } = await supabase.from("shift_logs")
          .update({ status: "replaced_by_other", hours_worked: 0, night_hours: 0, notes: `Replaced by ${reliefName}` })
          .eq("id", existingOriginalLog.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shift_logs").insert({
          tenant_id: profile.tenant_id,
          employee_id: a.employee_id, site_id: a.site_id, date: a.date,
          shift_type_id: a.shift_type_id, pay_period_id: payPeriod.id,
          assignment_id: a.id, hours_worked: 0, night_hours: 0,
          status: "replaced_by_other", notes: `Replaced by ${reliefName}`,
        });
        if (error) throw error;
      }

      // 2. Create a relief assignment for the relief guard at the same site (so client billing tracks the site)
      const { data: reliefAssignment, error: aErr } = await supabase
        .from("schedule_assignments")
        .insert({
          tenant_id: profile.tenant_id,
          employee_id: reliefEmpId,
          site_id: a.site_id, date: a.date,
          shift_type_id: a.shift_type_id,
          planned_hours: a.planned_hours,
          is_replacement: true,
          replaced_assignment_id: a.id,
          notes: `Relief for ${empById.get(a.employee_id)?.surname ?? ""}`,
        })
        .select("id").single();
      if (aErr) throw aErr;

      // 3. Insert a shift_log for the relief guard as "pending" — finding a relief
      //    doesn't mark them present. The supervisor still marks present/absent for
      //    them on the muster like any other guard.
      const { error: lErr } = await supabase.from("shift_logs").insert({
        tenant_id: profile.tenant_id,
        employee_id: reliefEmpId,
        site_id: a.site_id, date: a.date,
        shift_type_id: a.shift_type_id,
        pay_period_id: payPeriod.id,
        assignment_id: reliefAssignment.id,
        hours_worked: 0,
        night_hours: 0,
        status: "pending",
        notes: `Relief — covering for ${empById.get(a.employee_id)?.surname ?? "absent guard"}`,
      });
      if (lErr) throw lErr;

      toast.success(`${reliefName} assigned as relief — mark them present/absent once confirmed`);
      setReplaceFor(null);
      await Promise.all([
        refetchLogs(),
        qc.invalidateQueries({ queryKey: ["assignments-day"] }),
        qc.invalidateQueries({ queryKey: ["assignments-week"] }),
      ]);
    } catch (err) {
      // Surface Postgres / PostgREST detail so the cause is actually visible
      const e = err as { message?: string; code?: string; details?: string; hint?: string } | null;
      const parts = [
        e?.message ?? "Replacement failed",
        e?.code ? `(code ${e.code})` : "",
        e?.details ? `\n${e.details}` : "",
        e?.hint ? `\nHint: ${e.hint}` : "",
      ].filter(Boolean);
      console.error("Replacement failed:", err);
      toast.error(parts.join(" "), { duration: 10000 });
    } finally {
      setSaving(false);
    }
  }

  async function saveDeduction() {
    if (!deductFor || !profile?.tenant_id || !payPeriod) {
      toast.error("No open pay period for this date.");
      return;
    }
    if (!deductTypeId) {
      toast.error("Pick a deduction type.");
      return;
    }
    const dt = deductionTypes?.find((x) => x.id === deductTypeId);
    const amount = Number(deductAmount || dt?.default_amount || 0);
    if (amount <= 0) {
      toast.error("Amount must be greater than 0.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("deductions").insert({
        tenant_id: profile.tenant_id,
        employee_id: deductFor.employee_id,
        pay_period_id: payPeriod.id,
        deduction_type_id: deductTypeId,
        amount,
        incident_date: deductFor.date,
        incident_site_id: deductFor.site_id,
        note: deductNote || null,
        created_by: profile.id,
      });
      if (error) throw error;
      toast.success(`Deduction saved · will apply on next payroll run`);
      setDeductFor(null);
      setDeductTypeId("");
      setDeductAmount("");
      setDeductNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function openFlag(a: Assignment, prefill?: { offence: string; note: string; level: (typeof SUPERVISOR_ACTION_TYPES)[number] }) {
    setFlagFor(a);
    setFlagOffence(prefill?.offence ?? OFFENCES[0]);
    setFlagNote(prefill?.note ?? "");
    setFlagActionType(prefill?.level ?? "written_warning");
  }

  // Repeat unexcused absences don't file themselves — this just opens the offence dialog
  // prefilled with the dates so the supervisor confirms and signs off on it.
  function flagAwol(a: Assignment) {
    const dates = unexcusedByEmp.get(a.employee_id) ?? [];
    openFlag(a, {
      offence: "Absent without leave",
      note: `Unexcused absence on ${dates.join(", ")} — ${dates.length} this pay period.`,
      level: dates.length >= 3 ? "final_warning" : "written_warning",
    });
  }

  async function saveFlag() {
    if (!flagFor || !profile?.tenant_id) return;
    if (!flagNote.trim()) {
      toast.error("Describe what happened — payroll and HR rely on this note.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("disciplinary_actions").insert({
        tenant_id: profile.tenant_id,
        employee_id: flagFor.employee_id,
        action_type: flagActionType,
        offence_code: flagOffence,
        incident_date: flagFor.date,
        incident_site_id: flagFor.site_id,
        description: flagNote.trim(),
        fine_amount: 0,
        suspension_hours: 0,
        created_by: profile.id,
      });
      if (error) throw error;
      toast.success("Offence flagged — payroll will see it when verifying this period's run");
      setFlagFor(null);
      setFlagNote("");
      setFlagOffence(OFFENCES[0]);
      setFlagActionType("written_warning");
      void qc.invalidateQueries({ queryKey: ["disciplinary"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the flag");
    } finally {
      setSaving(false);
    }
  }

  function shiftDay(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(fmtIso(d));
    setPending({});
  }

  // Group visible by site for rendering
  function groupBySite(list: Assignment[]) {
    const m = new Map<string, Assignment[]>();
    list.forEach((a) => {
      const arr = m.get(a.site_id) ?? [];
      arr.push(a);
      m.set(a.site_id, arr);
    });
    return Array.from(m.entries());
  }

  // Day vs night comes off shift_types.period — the roster already records it, so the
  // muster only has to stop flattening the two into one list. Everything that isn't
  // explicitly a night shift counts as day (morning/day/full_day, or an unknown type).
  const sections = useMemo(() => {
    const day: Assignment[] = [];
    const night: Assignment[] = [];
    visibleAssignments.forEach((a) => {
      (shiftById.get(a.shift_type_id)?.period === "night" ? night : day).push(a);
    });
    const out: Array<{ key: "day" | "night"; label: string; list: Assignment[] }> = [];
    if (day.length) out.push({ key: "day", label: "Day shift", list: day });
    if (night.length) out.push({ key: "night", label: "Night shift", list: night });
    return out;
  }, [visibleAssignments, shiftById]);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" /> Daily Muster
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {dateObj.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            {payPeriod && <> · pay period <span className="font-mono">{payPeriod.label}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftDay(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPending({}); }} className="h-9 w-[160px] font-mono" />
          <Button variant="outline" size="sm" onClick={() => shiftDay(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { setDate(fmtIso(new Date())); setPending({}); }}>Today</Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expected</div>
          <div className="font-mono text-2xl font-bold">{stats.tot}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Present</div>
          <div className="font-mono text-2xl font-bold text-success">{stats.present}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Absent</div>
          <div className="font-mono text-2xl font-bold text-destructive">{stats.absent}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Replaced</div>
          <div className="font-mono text-2xl font-bold text-warning">{stats.replaced}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</div>
          <div className="font-mono text-2xl font-bold">{stats.pendingC}</div>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guards…" className="pl-9 h-9" />
          </div>
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sites</SelectItem>
              {scopedSites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!payPeriod && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-sm flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" />
            No open pay period covers {date}. Open one in Payroll before logging attendance.
          </CardContent>
        </Card>
      )}

      {sections.length === 0 && (
        <Card><CardContent className="p-12 text-center text-muted-foreground text-sm">
          No shifts scheduled for this date{siteFilter !== "all" ? " at this site" : ""}.
        </CardContent></Card>
      )}

      {/* One muster per shift period — each confirmed on its own, because the day and
          night guards are marked off by different supervisors at different times. */}
      {sections.map((section) => {
        const s = statsOf(section.list);
        const dirty = dirtyIn(section.list);
        return (
          <Card key={section.key} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold">{section.label}</span>
                <span className="text-xs text-muted-foreground">
                  {s.tot} expected · <span className="text-success">{s.present} present</span> ·{" "}
                  <span className="text-destructive">{s.absent} absent</span> ·{" "}
                  <span className="text-warning">{s.replaced} replaced</span> · {s.pendingC} unmarked
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={() => markAllPresent(section.list)} disabled={s.pendingC === 0}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark all present
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium border-b">Guard</th>
                    <th className="px-3 py-2 font-medium border-b">Shift</th>
                    <th className="px-3 py-2 font-medium border-b text-right">Hrs</th>
                    <th className="px-3 py-2 font-medium border-b">Wk total</th>
                    <th className="px-3 py-2 font-medium border-b">Mth total</th>
                    <th className="px-3 py-2 font-medium border-b">Status</th>
                    <th className="px-3 py-2 font-medium border-b text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupBySite(section.list).map(([siteId, list]) => (
                    <SiteGroup
                      key={siteId}
                      siteName={siteById.get(siteId)?.name ?? "—"}
                      count={list.length}
                      list={list}
                      empById={empById}
                      shiftById={shiftById}
                      weekHoursByEmp={weekHoursByEmp}
                      effectiveStatus={effectiveStatus}
                      pending={pending}
                      setStatus={setStatus}
                      openAbsence={openAbsence}
                      absenceNote={absenceNote}
                      setReplaceFor={setReplaceFor}
                      openFlag={openFlag}
                      flagAwol={flagAwol}
                      awolCount={(a) => unexcusedByEmp.get(a.employee_id)?.length ?? 0}
                      monthHours={(a) => monthHoursByEmp?.get(a.employee_id) ?? 0}
                      monthlyCap={hourCaps?.monthlyHours ?? 240}
                      canReplace={canReplace}
                      replacementNote={replacementNote}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-background px-3 py-3">
              <div className="text-sm flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                {dirty === 0
                  ? `${section.label} — all changes saved`
                  : `${dirty} pending change${dirty === 1 ? "" : "s"} on the ${section.label.toLowerCase()}`}
              </div>
              <div className="flex items-center gap-2">
                {dirty > 0 && (
                  <Button variant="outline" size="sm" onClick={() => discard(section.list)}>Discard</Button>
                )}
                <Button onClick={() => confirm(section.list)} disabled={!payPeriod || dirty === 0 || saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Confirm {section.label.toLowerCase()}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {capBreaches.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-sm flex items-start gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong>
                {capBreaches.length} guard{capBreaches.length === 1 ? "" : "s"} would pass the{" "}
                {hourCaps?.monthlyHours ?? 240}h monthly cap
              </strong>{" "}
              — {capBreaches.map((b) => `${b.name} (${b.total.toFixed(0)}h)`).join(", ")}.
              {hourCaps?.enforce
                ? " Confirming will be rejected; move the shift or reduce the hours."
                : " Confirming is still allowed, but the excess is recorded against the cap."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Replacement dialog */}
      <Dialog open={!!replaceFor} onOpenChange={(open) => { if (!open) setReplaceFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Find replacement
            </DialogTitle>
            <DialogDescription>
              {replaceFor && (
                <>
                  {empById.get(replaceFor.employee_id)?.surname}, {empById.get(replaceFor.employee_id)?.first_names} is absent.{" "}
                  Suggesting off-duty guards within the {WEEKLY_HOUR_CAP}h weekly cap.
                  Hours go to <span className="font-medium">{siteById.get(replaceFor.site_id)?.name}</span> for billing.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[400px] overflow-y-auto border rounded-md">
            {replacementCandidates.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No off-duty guards available within legal hour limits. Consider filing a PS exemption.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Guard</th>
                    <th className="px-3 py-2 font-medium text-right">Wk before</th>
                    <th className="px-3 py-2 font-medium text-right">Wk after</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {replacementCandidates.map(({ emp, weekBefore, weekAfter, overCap }) => (
                    <tr key={emp.id} className={cn("border-t hover:bg-muted/30", overCap && "bg-destructive/5")}>
                      <td className="px-3 py-2">
                        <div className="font-medium flex items-center gap-2">
                          {emp.surname}, {emp.first_names}
                          {overCap && (
                            <Badge variant="destructive" className="text-[10px] h-5">
                              <AlertTriangle className="h-3 w-3 mr-1" /> over 60h
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">{emp.employee_code}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{weekBefore.toFixed(0)}h</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={cn(weekAfter > 50 && "text-warning", weekAfter > WEEKLY_HOUR_CAP && "text-destructive font-bold")}>{weekAfter.toFixed(0)}h</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant={overCap ? "destructive" : "default"}
                          onClick={() => applyReplacement(emp.id, overCap)}
                          disabled={saving}
                        >
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
                          {overCap ? "Override & Assign" : "Assign"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceFor(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Absence reason dialog — a guard is never marked not present without a reason */}
      <Dialog open={!!absentFor} onOpenChange={(open) => { if (!open) setAbsentFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" /> Mark not present
            </DialogTitle>
            <DialogDescription>
              {absentFor && (
                <>
                  {empById.get(absentFor.employee_id)?.surname}, {empById.get(absentFor.employee_id)?.first_names}
                  {" · "}{siteById.get(absentFor.site_id)?.name}{" · "}{absentFor.date}.{" "}
                </>
              )}
              The reason is saved on the shift log and shown to payroll — this shift pays 0 hours.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <Select value={absentReason} onValueChange={setAbsentReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ABSENCE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>
                {absentReason === ABSENCE_REASON_OTHER ? (
                  <>Reason <span className="text-destructive">*</span></>
                ) : (
                  "Detail (optional)"
                )}
              </Label>
              <Textarea
                rows={3}
                value={absentNote}
                onChange={(e) => setAbsentNote(e.target.value)}
                placeholder={
                  absentReason === ABSENCE_REASON_OTHER
                    ? "Type what happened…"
                    : "Anything payroll should know — who you spoke to, time reported, etc."
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbsentFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={applyAbsence}>
              <XCircle className="h-4 w-4 mr-2" /> Mark not present
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offence flag dialog — files a warning against the guard for this shift */}
      <Dialog open={!!flagFor} onOpenChange={(open) => { if (!open) setFlagFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" /> Flag an offence
            </DialogTitle>
            <DialogDescription>
              {flagFor && (
                <>
                  {empById.get(flagFor.employee_id)?.surname}, {empById.get(flagFor.employee_id)?.first_names}
                  {" · "}{siteById.get(flagFor.site_id)?.name}{" · "}{flagFor.date}.{" "}
                </>
              )}
              Payroll sees this flag on the guard's row when verifying the payroll run. Fines,
              suspensions and dismissals are decided by management, not here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Offence</Label>
              <Select value={flagOffence} onValueChange={setFlagOffence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OFFENCES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Level</Label>
              <Select
                value={flagActionType}
                onValueChange={(v) => setFlagActionType(v as (typeof SUPERVISOR_ACTION_TYPES)[number])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPERVISOR_ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{disciplinaryActionLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>What happened <span className="text-destructive">*</span></Label>
              <Textarea
                rows={3}
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="e.g. Found asleep in the guard hut at 02:40 during patrol check."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagFor(null)}>Cancel</Button>
            <Button onClick={saveFlag} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
              Flag offence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SiteGroupProps = {
  siteName: string;
  count: number;
  list: Assignment[];
  empById: Map<string, Employee>;
  shiftById: Map<string, ShiftType>;
  weekHoursByEmp: Map<string, number>;
  effectiveStatus: (a: Assignment) => ShiftLog["status"];
  pending: Record<string, { status: ShiftLog["status"]; notes?: string }>;
  setStatus: (a: Assignment, status: ShiftLog["status"]) => void;
  openAbsence: (a: Assignment) => void;
  absenceNote: (a: Assignment) => string | null;
  setReplaceFor: (a: Assignment) => void;
  openFlag: (a: Assignment) => void;
  flagAwol: (a: Assignment) => void;
  awolCount: (a: Assignment) => number;
  monthHours: (a: Assignment) => number;
  monthlyCap: number;
  canReplace: boolean;
  replacementNote: (a: Assignment) => string | null;
};

function SiteGroup({ siteName, count, list, empById, shiftById, weekHoursByEmp, effectiveStatus, pending, setStatus, openAbsence, absenceNote, setReplaceFor, openFlag, flagAwol, awolCount, monthHours, monthlyCap, canReplace, replacementNote }: SiteGroupProps) {
  return (
    <>
      <tr className="bg-primary/5">
        <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {siteName} <span className="opacity-60 font-normal">· {count} guard{count === 1 ? "" : "s"}</span>
        </td>
      </tr>
      {list.map((a) => {
        const e = empById.get(a.employee_id);
        const st = shiftById.get(a.shift_type_id);
        const status = effectiveStatus(a);
        const wkHours = weekHoursByEmp.get(a.employee_id) ?? 0;
        const isDirty = a.id in pending;
        const note = replacementNote(a);
        return (
          <tr key={a.id} className={cn("border-t hover:bg-muted/20", isDirty && "bg-warning/5")}>
            <td className="px-3 py-2">
              <div className="font-medium leading-tight">{e?.surname}, {e?.first_names}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{e?.employee_code}</div>
              {note && (
                <div className="text-[11px] text-warning flex items-center gap-1 mt-0.5">
                  <UserPlus className="h-3 w-3" /> {note}
                </div>
              )}
              {absenceNote(a) && (
                <div className="text-[11px] text-destructive flex items-start gap-1 mt-0.5">
                  <XCircle className="h-3 w-3 mt-0.5 shrink-0" /> {absenceNote(a)}
                </div>
              )}
              {awolCount(a) >= 2 && (
                <button
                  type="button"
                  onClick={() => flagAwol(a)}
                  className="text-[11px] text-warning hover:underline flex items-center gap-1 mt-0.5"
                  title="Open the offence dialog prefilled with these dates"
                >
                  <ShieldAlert className="h-3 w-3" />
                  {awolCount(a)} unexcused absences this period — flag?
                </button>
              )}
            </td>
            <td className="px-3 py-2">
              <div className="font-mono text-xs font-medium">{st?.code}</div>
              <div className="text-[11px] text-muted-foreground">{st?.label}</div>
            </td>
            <td className="px-3 py-2 text-right font-mono">{Number(a.planned_hours).toFixed(0)}h</td>
            <td className="px-3 py-2">
              <span className={cn("font-mono text-xs", wkHours > WEEKLY_HOUR_CAP && "text-destructive font-bold", wkHours > 55 && wkHours <= WEEKLY_HOUR_CAP && "text-warning")}>
                {wkHours.toFixed(0)}h
              </span>
            </td>
            <td className="px-3 py-2">
              {(() => {
                const mth = monthHours(a);
                const st = capStatus(mth, monthlyCap);
                return (
                  <span
                    className={cn("font-mono text-xs", CAP_STATUS_CLASS[st])}
                    title={`${mth.toFixed(0)}h of ${monthlyCap}h monthly cap`}
                  >
                    {mth.toFixed(0)}h
                  </span>
                );
              })()}
            </td>
            <td className="px-3 py-2">
              <StatusBadge status={status} dirty={isDirty} />
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm" variant={status === "approved" || status === "submitted" ? "default" : "outline"}
                  className={cn("h-7 px-2", (status === "approved" || status === "submitted") && "bg-success hover:bg-success/90 text-success-foreground")}
                  onClick={() => setStatus(a, "approved")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant={status === "no_show" ? "default" : "outline"}
                  className={cn("h-7 px-2", status === "no_show" && "bg-destructive hover:bg-destructive/90 text-destructive-foreground")}
                  onClick={() => openAbsence(a)}
                  title="Mark not present (reason required)"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 px-2"
                  onClick={() => openFlag(a)}
                  title="Flag an offence (sleeping on duty, uniform, …)"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                </Button>
                {canReplace && (
                  <Button
                    size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => setReplaceFor(a)}
                    disabled={status === "approved" || status === "replaced_by_other"}
                    title="Find replacement"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function StatusBadge({ status, dirty }: { status: ShiftLog["status"]; dirty: boolean }) {
  const map: Record<ShiftLog["status"], { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
    submitted: { label: "Awaiting approval", className: "bg-primary/15 text-primary border-primary/30" },
    approved: { label: "Present", className: "bg-success/15 text-success border-success/30" },
    no_show: { label: "Absent", className: "bg-destructive/15 text-destructive border-destructive/30" },
    replaced_by_other: { label: "Replaced", className: "bg-warning/15 text-warning border-warning/30" },
    suspended_unpaid: { label: "Suspended", className: "bg-muted text-muted-foreground" },
  };
  const m = map[status];
  return (
    <Badge variant="outline" className={cn("font-medium border", m.className)}>
      {m.label}{dirty && " *"}
    </Badge>
  );
}
