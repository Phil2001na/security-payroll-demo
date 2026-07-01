import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChevronLeft, ChevronRight, Save, AlertTriangle,
  Loader2, Search, ShieldCheck, Eraser, Users, Wand2, Plus, X,
  Clock, Sparkles, ListChecks, CalendarRange, DollarSign, Printer, Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { estimateShiftCost, round2 } from "@/lib/payroll-engine";
import { buildScheduleSheetsPDF } from "@/lib/schedule-pdf";
import { formatNAD } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/schedule")({
  component: SchedulePage,
  head: () => ({ meta: [{ title: "Schedule — Demo Payroll System" }] }),
});

type ShiftType = {
  id: string;
  code: string;
  label: string;
  default_hours: number;
  pay_rule: string;
  period: string;
  active: boolean;
  is_leave: boolean;
};
type LiteracyGrade = "A+" | "A" | "B" | "C" | "D";
type Site = { id: string; name: string; code: string | null; required_guard_grade: LiteracyGrade | null };
type Employee = {
  id: string; employee_code: string; surname: string; first_names: string;
  home_site_id: string | null; status: string;
  preferred_shift: "day" | "night" | "both";
  hourly_rate: number;
  literacy_grade: LiteracyGrade | null;
  ordinarily_works_sundays: boolean;
};
type Assignment = {
  id: string;
  employee_id: string;
  site_id: string;
  date: string;
  shift_type_id: string;
  planned_hours: number;
};
type PSExemption = { id: string; employee_id: string; effective_from: string; effective_to: string; reference: string };
type SiteRequirement = {
  site_id: string;
  day_of_week: number;
  shift_kind: "day" | "night";
  quantity_required: number;
  shift_type_id: string | null;
};

const WEEKLY_HOUR_CAP = 60;
const MAX_WORKING_DAYS_PER_WEEK = 6; // guarantees at least 1 full rest day per ISO week

// Best→worst literacy grade. Ungraded employees (null) rank as worst (D-equivalent)
// so they stay assignable — never excluded, just least-preferred on grade fit.
const GRADE_RANK: Record<LiteracyGrade, number> = { "A+": 0, "A": 1, "B": 2, "C": 3, "D": 4 };
function gradeRank(grade: LiteracyGrade | null): number {
  return grade ? GRADE_RANK[grade] : GRADE_RANK["D"];
}
// 0 = meets-or-exceeds the site's requirement (best); >0 = how many grade steps
// below requirement (worse). A null requirement always yields 0, so grade has
// zero influence on sort order for sites with no requirement set.
function gradeFitScore(employeeGrade: LiteracyGrade | null, requiredGrade: LiteracyGrade | null): number {
  if (!requiredGrade) return 0;
  return Math.max(0, gradeRank(employeeGrade) - GRADE_RANK[requiredGrade]);
}

const SCHED_CONSTANTS = {
  weekly_ordinary_cap: 60,
  overtime_multiplier: 1.5,
  sunday_multiplier: 2.0,
  sunday_agreed_multiplier: 1.5,
  public_holiday_multiplier: 2.0,
  night_premium_rate: 0.06,
} as const;

// ── Shift visual category (drives color) ─────────────────────────────────────
type ShiftKind = "day" | "night" | "double" | "leave" | "other";
function shiftKindOf(st: ShiftType | undefined | null): ShiftKind {
  if (!st) return "other";
  if (st.is_leave) return "leave";
  const p = st.period;
  if (p === "night") return "night";
  if (st.default_hours >= 20) return "double";
  if (p === "day" || p === "morning" || p === "full_day") return "day";
  return "other";
}
const KIND_STYLES: Record<ShiftKind, { block: string; label: string; pill: string; dot: string; border: string }> = {
  day:    { block: "bg-amber-100 border-amber-300 hover:bg-amber-200/80",   label: "text-amber-800",   pill: "bg-amber-200 text-amber-900",   dot: "bg-amber-400",   border: "border-amber-300" },
  night:  { block: "bg-indigo-100 border-indigo-300 hover:bg-indigo-200/80", label: "text-indigo-800", pill: "bg-indigo-200 text-indigo-900", dot: "bg-indigo-500",  border: "border-indigo-300" },
  double: { block: "bg-emerald-100 border-emerald-300 hover:bg-emerald-200/80", label: "text-emerald-800", pill: "bg-emerald-200 text-emerald-900", dot: "bg-emerald-500", border: "border-emerald-300" },
  leave:  { block: "bg-slate-100 border-slate-300 hover:bg-slate-200/80",   label: "text-slate-700",   pill: "bg-slate-200 text-slate-800",   dot: "bg-slate-400",   border: "border-slate-300" },
  other:  { block: "bg-sky-100 border-sky-300 hover:bg-sky-200/80",         label: "text-sky-800",     pill: "bg-sky-200 text-sky-900",       dot: "bg-sky-400",     border: "border-sky-300" },
};

function fmtIso(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d: Date) {
  // Monday-start
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7; // 0=Mon
  t.setDate(t.getDate() - dow);
  return t;
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function isoWeekKey(d: Date) {
  return fmtIso(startOfWeek(d));
}
function sameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function rangeDaysBetween(fromStr: string, toStr: string): Date[] {
  const start = parseIsoDate(fromStr);
  const end = parseIsoDate(toStr);
  const out: Date[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur);
  return out;
}
function isoDateAdd(dateStr: string, n: number): string {
  return fmtIso(addDays(parseIsoDate(dateStr), n));
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
// Mon-start calendar grid for the given month, padded to full weeks before/after.
function monthCalendarWeeks(monthAnchor: Date): Date[][] {
  const first = startOfMonth(monthAnchor);
  const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(startOfWeek(last), 6);
  const weeks: Date[][] = [];
  for (let wkStart = gridStart; wkStart <= gridEnd; wkStart = addDays(wkStart, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(wkStart, i)));
  }
  return weeks;
}

function SchedulePage() {
  const { profile } = useAuth();
  const role = profile?.role;
  if (role && role !== "admin" && role !== "operations" && role !== "supervisor" && role !== "payroll") {
    return <AccessDenied message="Schedule access is restricted to payroll and operations staff." />;
  }
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [search, setSearch] = useState("");
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  // Pending edits: key = `${employeeId}|${date}` -> shift_type_id (empty string = clear)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ empId: string; date: string } | null>(null);
  const [guardMonthEmpId, setGuardMonthEmpId] = useState<string | null>(null);
  const [guardMonthCursor, setGuardMonthCursor] = useState<Date>(() => new Date());
  const [customRequestDate, setCustomRequestDate] = useState<string | null>(null);
  const [customRequest, setCustomRequest] = useState({ siteId: "", startTime: "23:00", endTime: "05:00", guardsNeeded: "1" });
  const [customRequestRunning, setCustomRequestRunning] = useState(false);
  const [genFrom, setGenFrom] = useState<string>("");
  const [genTo, setGenTo] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const defaultedRangeRef = useRef(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = fmtIso(days[0]);
  const rangeEnd = fmtIso(days[6]);
  // Wider window for weekly hour/rest-day totals — covers the visible week + neighbouring
  // days, widened further to also cover any custom generate/print range the user picks.
  // Snapped to full ISO weeks (+1 day buffer either side) so the weekly-rest-day count and
  // the rest-between-shifts check always see the days immediately bordering the range.
  const fetchStart = (() => {
    const base = addDays(weekStart, -7);
    const earliest = genFrom && parseIsoDate(genFrom) < base ? parseIsoDate(genFrom) : base;
    return fmtIso(addDays(startOfWeek(earliest), -1));
  })();
  const fetchEnd = (() => {
    const base = addDays(weekStart, 13);
    const latest = genTo && parseIsoDate(genTo) > base ? parseIsoDate(genTo) : base;
    return fmtIso(addDays(startOfWeek(latest), 7));
  })();

  const { data: sites } = useQuery<Site[]>({
    queryKey: ["sites", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites").select("id, name, code, required_guard_grade").eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!activeSiteId && sites && sites.length) setActiveSiteId(sites[0].id);
  }, [sites, activeSiteId]);

  const { data: tenant } = useQuery({
    queryKey: ["tenant"],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const { data: openPeriod } = useQuery({
    queryKey: ["open-pay-period", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods").select("start_date, end_date, label")
        .eq("status", "open").order("start_date", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (defaultedRangeRef.current) return;
    if (openPeriod) {
      defaultedRangeRef.current = true;
      setGenFrom(openPeriod.start_date);
      setGenTo(openPeriod.end_date);
    } else if (rangeStart && rangeEnd) {
      setGenFrom((v) => v || rangeStart);
      setGenTo((v) => v || rangeEnd);
    }
  }, [openPeriod, rangeStart, rangeEnd]);

  const { data: shiftTypes } = useQuery<ShiftType[]>({
    queryKey: ["shift-types", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types").select("id, code, label, default_hours, pay_rule, period, active, is_leave")
        .eq("active", true).order("code");
      if (error) throw error;
      return (data ?? []) as ShiftType[];
    },
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["employees-active", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_code, surname, first_names, home_site_id, status, preferred_shift, contract_signed_at, category, hourly_rate, literacy_grade, ordinarily_works_sundays")
        .eq("status", "active")
        .order("surname");
      if (error) throw error;
      // Officers without a signed contract may not be rostered. Management
      // staff are salaried and don't appear here anyway, so filter on category=officer.
      const list = (data ?? []) as (Employee & { contract_signed_at: string | null; category: string })[];
      return list as Employee[];
    },
  });

  const { data: assignments, refetch: refetchAssignments } = useQuery<Assignment[]>({
    queryKey: ["assignments", profile?.tenant_id, rangeStart, rangeEnd, activeSiteId],
    enabled: !!profile?.tenant_id && !!activeSiteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .eq("site_id", activeSiteId!)
        .gte("date", rangeStart).lte("date", rangeEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Cross-site assignments for weekly hour totals
  const { data: weekAssignments, isFetching: weekAssignmentsFetching } = useQuery<Assignment[]>({
    queryKey: ["assignments-all", profile?.tenant_id, fetchStart, fetchEnd],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .gte("date", fetchStart).lte("date", fetchEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  // One guard's full month, across every site — for the "view guard month" modal
  const guardMonthWeeks = useMemo(() => monthCalendarWeeks(guardMonthCursor), [guardMonthCursor]);
  const guardMonthFrom = fmtIso(guardMonthWeeks[0][0]);
  const guardMonthTo = fmtIso(guardMonthWeeks[guardMonthWeeks.length - 1][6]);
  const { data: guardMonthAssignments, isFetching: guardMonthFetching } = useQuery<Assignment[]>({
    queryKey: ["guard-month", guardMonthEmpId, guardMonthFrom, guardMonthTo],
    enabled: !!guardMonthEmpId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .eq("employee_id", guardMonthEmpId!)
        .gte("date", guardMonthFrom).lte("date", guardMonthTo);
      if (error) throw error;
      return data ?? [];
    },
  });
  const guardMonthByDate = useMemo(() => {
    const m = new Map<string, Assignment>();
    (guardMonthAssignments ?? []).forEach((a) => m.set(a.date, a));
    return m;
  }, [guardMonthAssignments]);

  const { data: exemptions } = useQuery<PSExemption[]>({
    queryKey: ["ps-exemptions", profile?.tenant_id, rangeStart, rangeEnd],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ps_exemptions")
        .select("id, employee_id, effective_from, effective_to, reference")
        .lte("effective_from", rangeEnd).gte("effective_to", rangeStart);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: requirements } = useQuery<SiteRequirement[]>({
    queryKey: ["site-requirements-all", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_requirements")
        .select("site_id, day_of_week, shift_kind, quantity_required, shift_type_id");
      if (error) throw error;
      return (data ?? []) as SiteRequirement[];
    },
  });

  const { data: publicHolidays } = useQuery<{ date: string }[]>({
    queryKey: ["public-holidays", rangeStart, rangeEnd, profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_holidays")
        .select("date")
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  const publicHolidayDates = useMemo(
    () => new Set((publicHolidays ?? []).map((h) => h.date)),
    [publicHolidays],
  );

  // Roster shows: guards whose home_site = active site, plus anyone with an assignment on this site this week
  const siteEmployees = useMemo(() => {
    if (!employees || !activeSiteId) return [];
    const ids = new Set<string>();
    employees.forEach((e) => { if (e.home_site_id === activeSiteId) ids.add(e.id); });
    (assignments ?? []).forEach((a) => ids.add(a.employee_id));
    let list = employees.filter((e) => ids.has(e.id));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) =>
        e.surname.toLowerCase().includes(q) ||
        e.first_names.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q)
      );
    }
    return list;
  }, [employees, activeSiteId, assignments, search]);

  const shiftTypeById = useMemo(() => {
    const m = new Map<string, ShiftType>();
    (shiftTypes ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [shiftTypes]);

  const assignByKey = useMemo(() => {
    const m = new Map<string, Assignment>();
    (assignments ?? []).forEach((a) => m.set(`${a.employee_id}|${a.date}`, a));
    return m;
  }, [assignments]);

  const effectiveShiftId = (empId: string, date: string): string | null => {
    const k = `${empId}|${date}`;
    if (k in edits) return edits[k] || null;
    const a = assignByKey.get(k);
    return a ? a.shift_type_id : null;
  };

  // Weekly totals (across all sites) including pending edits
  const weeklyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    const editedKeys = new Set(Object.keys(edits));
    (weekAssignments ?? []).forEach((a) => {
      const k = `${a.employee_id}|${a.date}`;
      if (editedKeys.has(k)) return;
      const wk = isoWeekKey(new Date(a.date));
      totals.set(`${a.employee_id}|${wk}`, (totals.get(`${a.employee_id}|${wk}`) ?? 0) + Number(a.planned_hours));
    });
    Object.entries(edits).forEach(([k, sid]) => {
      const [empId, date] = k.split("|");
      if (!sid) return;
      const hours = shiftTypeById.get(sid)?.default_hours ?? 0;
      const wk = isoWeekKey(new Date(date));
      totals.set(`${empId}|${wk}`, (totals.get(`${empId}|${wk}`) ?? 0) + hours);
    });
    return totals;
  }, [weekAssignments, edits, shiftTypeById]);

  const exemptionForWeek = (empId: string, wkStart: Date): PSExemption | null => {
    const wkS = fmtIso(wkStart);
    const wkE = fmtIso(addDays(wkStart, 6));
    return (exemptions ?? []).find((x) =>
      x.employee_id === empId && x.effective_from <= wkE && x.effective_to >= wkS
    ) ?? null;
  };

  type Breach = { empId: string; weekKey: string; hours: number; covered: boolean };
  const breaches = useMemo<Breach[]>(() => {
    const out: Breach[] = [];
    weeklyTotals.forEach((hours, key) => {
      if (hours <= WEEKLY_HOUR_CAP) return;
      const [empId, wk] = key.split("|");
      const ex = exemptionForWeek(empId, new Date(wk));
      out.push({ empId, weekKey: wk, hours, covered: !!ex });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeklyTotals, exemptions]);

  const blocking = breaches.filter((b) => !b.covered);
  const dirtyCount = Object.keys(edits).length;
  const canSave = dirtyCount > 0 && blocking.length === 0 && !saving;

  function setCell(empId: string, date: string, shiftId: string) {
    setEdits((prev) => {
      const next = { ...prev };
      const k = `${empId}|${date}`;
      const existing = assignByKey.get(k);
      if (existing && existing.shift_type_id === shiftId) delete next[k];
      else if (!existing && !shiftId) delete next[k];
      else next[k] = shiftId;
      return next;
    });
  }

  async function save() {
    if (!profile?.tenant_id || !activeSiteId) return;
    setSaving(true);
    try {
      const inserts: Array<Omit<Assignment, "id"> & { tenant_id: string }> = [];
      const updates: Array<{ id: string; shift_type_id: string; planned_hours: number }> = [];
      const deletes: string[] = [];

      for (const [k, shiftId] of Object.entries(edits)) {
        const [empId, date] = k.split("|");
        const existing = assignByKey.get(k);
        if (!shiftId) { if (existing) deletes.push(existing.id); continue; }
        const st = shiftTypeById.get(shiftId);
        if (!st) continue;
        if (existing) {
          updates.push({ id: existing.id, shift_type_id: shiftId, planned_hours: st.default_hours });
        } else {
          inserts.push({
            tenant_id: profile.tenant_id, employee_id: empId, site_id: activeSiteId,
            date, shift_type_id: shiftId, planned_hours: st.default_hours,
          });
        }
      }
      if (deletes.length) {
        const { error } = await supabase.from("schedule_assignments").delete().in("id", deletes);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from("schedule_assignments")
          .update({ shift_type_id: u.shift_type_id, planned_hours: u.planned_hours })
          .eq("id", u.id);
        if (error) throw error;
      }
      if (inserts.length) {
        for (let i = 0; i < inserts.length; i += 200) {
          const { error } = await supabase.from("schedule_assignments").insert(inserts.slice(i, i + 200));
          if (error) throw error;
        }
      }

      toast.success(`Roster saved · ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`);
      setEdits({});
      await Promise.all([
        refetchAssignments(),
        qc.invalidateQueries({ queryKey: ["assignments-all"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Auto-Fill (current visible week) ─────────────────────────────────────
  const autoShiftTypes = useMemo(() => {
    const st = shiftTypes ?? [];
    const candidates = st.filter((s) =>
      s.active && !s.is_leave && s.default_hours > 0 && s.pay_rule === "standard"
    );
    const findBy = (periods: string[]) => candidates.find((s) => periods.includes(s.period)) ?? null;
    const day = findBy(["day"]) ?? findBy(["full_day"]);
    const night = findBy(["night"]);
    return { day, night };
  }, [shiftTypes]);

  type FillPlan = {
    shortfalls: { siteId: string; date: string; kind: "day" | "night"; required: number; have: number; short: number }[];
    newAssignments: { employee_id: string; site_id: string; date: string; shift_type_id: string; planned_hours: number }[];
    qualityWarnings: { siteId: string; date: string; kind: "day" | "night"; employeeId: string; employeeName: string; requiredGrade: LiteracyGrade; assignedGrade: string }[];
    unassignable: number;
    preferenceOverrides: number;
  };

  // rangeDays may span multiple ISO weeks (e.g. a full generate range) — the 60h cap
  // is tracked per (employee, ISO week) pair so multi-week ranges reset correctly each week.
  function buildFillPlan(rangeDays: Date[]): FillPlan {
    const plan: FillPlan = { shortfalls: [], newAssignments: [], qualityWarnings: [], unassignable: 0, preferenceOverrides: 0 };
    if (!sites || !employees || !requirements || !weekAssignments) return plan;
    if (!autoShiftTypes.day && !autoShiftTypes.night) return plan;

    const planDates = rangeDays.map((d) => ({ date: fmtIso(d), dow: d.getDay() }));
    const planDateSet = new Set(planDates.map((w) => w.date));
    const weekKeyOf = (date: string) => isoWeekKey(new Date(date));

    // Process ordinary weekdays first, then Sunday, then public holidays so
    // guards who accumulate hours on weekdays are naturally excluded from premium
    // slots — rest days fall on the expensive days, cheapest remaining guards cover them.
    const orderedDates = [...planDates].sort((a, b) => {
      const aPriority = publicHolidayDates.has(a.date) ? 2 : a.dow === 0 ? 1 : 0;
      const bPriority = publicHolidayDates.has(b.date) ? 2 : b.dow === 0 ? 1 : 0;
      return aPriority - bPriority || a.date.localeCompare(b.date);
    });

    const effectiveKind = (shiftId: string): "day" | "night" | null => {
      const st = shiftTypeById.get(shiftId);
      if (!st) return null;
      if (st.period === "night") return "night";
      if (st.period === "day" || st.period === "full_day" || st.period === "morning") return "day";
      return null;
    };

    const empDates = new Map<string, Set<string>>();
    const empWeekHours = new Map<string, number>(); // key: `${empId}|${weekKey}`
    const empWeekOrdinaryHours = new Map<string, number>();
    // Tracks every worked date per (employee, ISO week) — including days outside this
    // plan's range — so the 1-rest-day-per-week rule sees the whole week, not just the slice
    // being generated.
    const empWeekDays = new Map<string, Set<string>>();
    // Tracks the shift kind worked on each date — including the day immediately before/after
    // this plan's range — so we can refuse to schedule a Day shift right after a Night ends
    // (or a Night right before a Day starts), which would leave zero rest between them.
    const empKindByDate = new Map<string, "day" | "night">();
    for (const emp of employees) empDates.set(emp.id, new Set());

    function markWorkedDay(empId: string, date: string) {
      const wk = `${empId}|${weekKeyOf(date)}`;
      if (!empWeekDays.has(wk)) empWeekDays.set(wk, new Set());
      empWeekDays.get(wk)!.add(date);
    }

    const editedKeys = new Set(Object.keys(edits));
    for (const a of weekAssignments) {
      const k = `${a.employee_id}|${a.date}`;
      const isEdited = editedKeys.has(k);
      const sid = isEdited ? edits[k] : a.shift_type_id;
      if (sid) {
        const kind = effectiveKind(sid);
        if (kind) empKindByDate.set(k, kind);
        markWorkedDay(a.employee_id, a.date);
      }
      // Count hours toward the weekly cap even when this date falls outside the plan's
      // range — a boundary week that started before the generated range still needs its
      // pre-existing hours counted, or the cap check below sees a false-empty week and
      // over-assigns. Pending edits are excluded here; the edits loop below counts them
      // instead (using the edited shift, not the original one).
      if (!isEdited) {
        const aHours = Number(a.planned_hours);
        const wk = `${a.employee_id}|${weekKeyOf(a.date)}`;
        empWeekHours.set(wk, (empWeekHours.get(wk) ?? 0) + aHours);
        const aSt = shiftTypeById.get(a.shift_type_id);
        if (aSt && aSt.pay_rule === "standard") {
          empWeekOrdinaryHours.set(wk, (empWeekOrdinaryHours.get(wk) ?? 0) + aHours);
        }
      }
      if (!planDateSet.has(a.date) || isEdited) continue;
      empDates.get(a.employee_id)?.add(a.date);
    }
    for (const [k, sid] of Object.entries(edits)) {
      const [empId, date] = k.split("|");
      if (!sid) continue;
      const kind = effectiveKind(sid);
      if (kind) empKindByDate.set(k, kind);
      markWorkedDay(empId, date);
      const st = shiftTypeById.get(sid);
      if (st) {
        const wk = `${empId}|${weekKeyOf(date)}`;
        empWeekHours.set(wk, (empWeekHours.get(wk) ?? 0) + st.default_hours);
        if (st.pay_rule === "standard") {
          empWeekOrdinaryHours.set(wk, (empWeekOrdinaryHours.get(wk) ?? 0) + st.default_hours);
        }
      }
      if (!st || !planDateSet.has(date)) continue;
      empDates.get(empId)?.add(date);
    }

    const coverage = new Map<string, number>();
    for (const a of weekAssignments) {
      if (!planDateSet.has(a.date)) continue;
      const k = `${a.employee_id}|${a.date}`;
      const sid = editedKeys.has(k) ? edits[k] : a.shift_type_id;
      if (!sid) continue;
      const kind = effectiveKind(sid);
      if (!kind) continue;
      coverage.set(`${a.site_id}|${a.date}|${kind}`, (coverage.get(`${a.site_id}|${a.date}|${kind}`) ?? 0) + 1);
    }
    for (const [k, sid] of Object.entries(edits)) {
      const [empId, date] = k.split("|");
      if (!planDateSet.has(date) || !sid) continue;
      const existing = (weekAssignments ?? []).find((a) => a.employee_id === empId && a.date === date);
      if (existing) continue;
      const kind = effectiveKind(sid);
      if (!kind || !activeSiteId) continue;
      coverage.set(`${activeSiteId}|${date}|${kind}`, (coverage.get(`${activeSiteId}|${date}|${kind}`) ?? 0) + 1);
    }

    for (const site of sites) {
      for (const wd of orderedDates) {
        for (const kind of ["day", "night"] as const) {
          const req = requirements.find((r) =>
            r.site_id === site.id && r.day_of_week === wd.dow && r.shift_kind === kind
          );
          const required = req?.quantity_required ?? 0;
          if (required === 0) continue;
          // A site/day/kind can pin its own shift template (e.g. a 6h half shift)
          // instead of the tenant's standard 12h Day/Night shift.
          const stForKind = (req?.shift_type_id ? shiftTypeById.get(req.shift_type_id) : null)
            ?? (kind === "day" ? autoShiftTypes.day : autoShiftTypes.night);
          if (!stForKind) continue;
          const isSunday = wd.dow === 0;
          const isPH = publicHolidayDates.has(wd.date);
          const shiftPayRule = isPH ? "public_holiday_ordinary" : isSunday ? "sunday_default" : stForKind.pay_rule;
          const ck = `${site.id}|${wd.date}|${kind}`;
          let have = coverage.get(ck) ?? 0;
          const needed = required - have;
          if (needed <= 0) continue;
          const shiftHours = stForKind.default_hours;
          const wkKey = weekKeyOf(wd.date);
          // Preference is a soft signal, not a hard requirement: fill from
          // preference-matching guards first, and only reach into off-preference
          // guards (day-preferred for a night slot, or vice versa) if that leaves
          // the slot genuinely short — so a shortage always beats an empty shift.
          const buildPool = (requirePreference: boolean) => employees.filter((emp) => {
            if (emp.status !== "active") return false;
            if (requirePreference && emp.preferred_shift !== kind && emp.preferred_shift !== "both") return false;
            if (empDates.get(emp.id)?.has(wd.date)) return false;
            const hrs = empWeekHours.get(`${emp.id}|${wkKey}`) ?? 0;
            if (hrs + shiftHours > WEEKLY_HOUR_CAP) return false;
            // Weekly rest: keep at least 1 day off in every ISO week.
            const workedDays = empWeekDays.get(`${emp.id}|${wkKey}`)?.size ?? 0;
            if (workedDays >= MAX_WORKING_DAYS_PER_WEEK) return false;
            // Rest between shifts: a Night ending the morning of the next date leaves
            // zero rest if that guard is then put on Day the same morning — block both
            // directions of that crossover (only "both"-preference guards can hit this).
            if (kind === "day" && empKindByDate.get(`${emp.id}|${isoDateAdd(wd.date, -1)}`) === "night") return false;
            if (kind === "night" && empKindByDate.get(`${emp.id}|${isoDateAdd(wd.date, 1)}`) === "day") return false;
            return true;
          });
          const sortPool = (arr: typeof employees) => arr.sort((a, b) => {
            // 1. Grade fit vs the site's requirement — quality-of-fit outranks cost
            //    and logistics. 0 covers every candidate when the site has no
            //    requirement, so this is a no-op tie for sites that don't opt in.
            const aFit = gradeFitScore(a.literacy_grade, site.required_guard_grade);
            const bFit = gradeFitScore(b.literacy_grade, site.required_guard_grade);
            if (aFit !== bFit) return aFit - bFit;
            // 2. Home site preference (logistics/familiarity)
            const aHome = a.home_site_id === site.id ? 0 : 1;
            const bHome = b.home_site_id === site.id ? 0 : 1;
            if (aHome !== bHome) return aHome - bHome;
            // 3. Shift preference specificity (avoids no-shows)
            const aSpec = a.preferred_shift === kind ? 1 : 0;
            const bSpec = b.preferred_shift === kind ? 1 : 0;
            if (aSpec !== bSpec) return bSpec - aSpec;
            // 4. Cheapest guard for this specific shift (cost optimisation)
            const aCost = estimateShiftCost(
              a.hourly_rate, shiftHours, empWeekOrdinaryHours.get(`${a.id}|${wkKey}`) ?? 0,
              shiftPayRule, kind === "night", SCHED_CONSTANTS, a.ordinarily_works_sundays,
            );
            const bCost = estimateShiftCost(
              b.hourly_rate, shiftHours, empWeekOrdinaryHours.get(`${b.id}|${wkKey}`) ?? 0,
              shiftPayRule, kind === "night", SCHED_CONSTANTS, b.ordinarily_works_sundays,
            );
            if (Math.abs(aCost - bCost) > 0.01) return aCost - bCost;
            // 5. Load-balance tie-break
            return (empWeekHours.get(`${a.id}|${wkKey}`) ?? 0) - (empWeekHours.get(`${b.id}|${wkKey}`) ?? 0);
          });
          let assigned = 0;
          const assignFrom = (pool: typeof employees, offPreference: boolean) => {
            for (const emp of pool) {
              if (assigned >= needed) break;
              plan.newAssignments.push({
                employee_id: emp.id, site_id: site.id, date: wd.date,
                shift_type_id: stForKind.id, planned_hours: shiftHours,
              });
              if (offPreference) plan.preferenceOverrides++;
              if (site.required_guard_grade && gradeRank(emp.literacy_grade) > GRADE_RANK[site.required_guard_grade]) {
                plan.qualityWarnings.push({
                  siteId: site.id, date: wd.date, kind,
                  employeeId: emp.id, employeeName: `${emp.surname}, ${emp.first_names}`,
                  requiredGrade: site.required_guard_grade,
                  assignedGrade: emp.literacy_grade ?? "Ungraded",
                });
              }
              empDates.get(emp.id)?.add(wd.date);
              markWorkedDay(emp.id, wd.date);
              empKindByDate.set(`${emp.id}|${wd.date}`, kind);
              const wk = `${emp.id}|${wkKey}`;
              empWeekHours.set(wk, (empWeekHours.get(wk) ?? 0) + shiftHours);
              if (shiftPayRule === "standard") {
                empWeekOrdinaryHours.set(wk, (empWeekOrdinaryHours.get(wk) ?? 0) + shiftHours);
              }
              coverage.set(ck, (coverage.get(ck) ?? 0) + 1);
              have++;
              assigned++;
            }
          };
          assignFrom(sortPool(buildPool(true)), false);
          if (assigned < needed) assignFrom(sortPool(buildPool(false)), true);
          if (assigned < needed) {
            plan.shortfalls.push({ siteId: site.id, date: wd.date, kind, required, have, short: needed - assigned });
            plan.unassignable += needed - assigned;
          }
        }
      }
    }
    return plan;
  }

  const [autoFilling, setAutoFilling] = useState(false);
  async function autoFillRoster() {
    if (!profile?.tenant_id) return;
    const plan = buildFillPlan(days);
    if (plan.newAssignments.length === 0 && plan.shortfalls.length === 0) {
      toast.info("Nothing to fill — requirements already met or none set.");
      return;
    }
    setAutoFilling(true);
    try {
      if (plan.newAssignments.length > 0) {
        const rows = plan.newAssignments.map((a) => ({ ...a, tenant_id: profile.tenant_id }));
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await supabase.from("schedule_assignments").insert(rows.slice(i, i + 200));
          if (error) throw error;
        }
      }
      const msg = `Auto-fill: ${plan.newAssignments.length} shift${plan.newAssignments.length === 1 ? "" : "s"} assigned`
        + (plan.unassignable > 0 ? ` · ${plan.unassignable} slot${plan.unassignable === 1 ? "" : "s"} short` : "")
        + (plan.preferenceOverrides > 0 ? ` · ${plan.preferenceOverrides} against shift preference` : "")
        + (plan.qualityWarnings.length > 0 ? ` · ${plan.qualityWarnings.length} below-grade` : "");
      if (plan.unassignable > 0 || plan.preferenceOverrides > 0 || plan.qualityWarnings.length > 0) toast.warning(msg);
      else toast.success(msg);
      await Promise.all([
        refetchAssignments(),
        qc.invalidateQueries({ queryKey: ["assignments-all"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-fill failed");
    } finally {
      setAutoFilling(false);
    }
  }

  const fillPlanPreview = useMemo(() => buildFillPlan(days),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, sites, employees, requirements, weekAssignments, edits, autoShiftTypes, shiftTypeById, activeSiteId, publicHolidayDates]
  );
  const shortfallPreview = fillPlanPreview.shortfalls;
  const qualityWarningPreview = fillPlanPreview.qualityWarnings;

  // ── Generate schedule for a custom date range (all sites) ────────────────
  async function generateSchedule() {
    if (!profile?.tenant_id) return;
    if (!genFrom || !genTo) { toast.error("Pick a start and end date"); return; }
    if (genFrom > genTo) { toast.error("Start date must be on or before the end date"); return; }
    const rangeDays = rangeDaysBetween(genFrom, genTo);
    if (rangeDays.length > 62) { toast.error("Range too large — generate at most ~2 months at a time"); return; }
    setGenerating(true);
    try {
      const plan = buildFillPlan(rangeDays);
      if (plan.newAssignments.length === 0) {
        toast.info(plan.shortfalls.length > 0
          ? "No eligible guards available to fill the gaps in this range."
          : "Nothing to generate — requirements already met or none set for this range.");
        return;
      }
      const rows = plan.newAssignments.map((a) => ({ ...a, tenant_id: profile.tenant_id }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("schedule_assignments").insert(rows.slice(i, i + 200));
        if (error) throw error;
      }
      const msg = `Schedule generated: ${plan.newAssignments.length} shift${plan.newAssignments.length === 1 ? "" : "s"} across ${rangeDays.length} day${rangeDays.length === 1 ? "" : "s"}`
        + (plan.unassignable > 0 ? ` · ${plan.unassignable} slot${plan.unassignable === 1 ? "" : "s"} short` : "")
        + (plan.preferenceOverrides > 0 ? ` · ${plan.preferenceOverrides} against shift preference` : "");
      if (plan.unassignable > 0 || plan.preferenceOverrides > 0) toast.warning(msg);
      else toast.success(msg);
      setWeekStart(startOfWeek(rangeDays[0]));
      await Promise.all([
        refetchAssignments(),
        qc.invalidateQueries({ queryKey: ["assignments-all"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  // ── Remove every shift in the selected date range (all sites) ────────────
  async function undoRange() {
    if (!profile?.tenant_id) return;
    if (!genFrom || !genTo) { toast.error("Pick a start and end date"); return; }
    if (genFrom > genTo) { toast.error("Start date must be on or before the end date"); return; }
    const ok = window.confirm(
      `Remove ALL shifts from ${genFrom} to ${genTo} across every site?\n\nThis deletes every assignment in that range, including manually added or edited ones, and cannot be undone.`
    );
    if (!ok) return;
    setUndoing(true);
    try {
      // Assignments with attendance already logged can't be deleted (FK blocks it) —
      // check first so we can name the actual count instead of a generic failure.
      const { count: loggedCount, error: checkError } = await supabase
        .from("schedule_assignments")
        .select("id, shift_logs!inner(id)", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id)
        .gte("date", genFrom)
        .lte("date", genTo);
      if (checkError) throw checkError;
      if (loggedCount && loggedCount > 0) {
        toast.error(
          `${loggedCount} shift${loggedCount === 1 ? "" : "s"} in this range already ${loggedCount === 1 ? "has" : "have"} attendance logged and can't be removed. Clear attendance for this period first, or narrow the date range.`
        );
        return;
      }
      const { data, error } = await supabase.from("schedule_assignments")
        .delete()
        .eq("tenant_id", profile.tenant_id)
        .gte("date", genFrom)
        .lte("date", genTo)
        .select("id");
      if (error) throw error;
      const removed = data?.length ?? 0;
      if (removed === 0) toast.info("Nothing to remove in that range.");
      else toast.success(`Removed ${removed} shift${removed === 1 ? "" : "s"} from ${genFrom} to ${genTo}`);
      await Promise.all([
        refetchAssignments(),
        qc.invalidateQueries({ queryKey: ["assignments-all"] }),
      ]);
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err ? String((err as { message?: string }).message) : undefined;
      toast.error(message || "Remove failed");
    } finally {
      setUndoing(false);
    }
  }

  // ── One-off custom guard request for a single date (e.g. an event, 11pm–5am) ─
  function customRequestHours(startTime: string, endTime: string): number {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60; // window wraps past midnight
    return round2(mins / 60);
  }
  function customRequestKind(startTime: string): "day" | "night" {
    const h = Number(startTime.split(":")[0]);
    return h >= 18 || h < 6 ? "night" : "day";
  }

  async function submitCustomRequest() {
    if (!profile?.tenant_id || !customRequestDate) return;
    const { siteId, startTime, endTime, guardsNeeded } = customRequest;
    if (!siteId) { toast.error("Pick a site"); return; }
    const needed = Math.max(1, Math.floor(Number(guardsNeeded) || 0));
    const hours = customRequestHours(startTime, endTime);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 12) {
      toast.error("Custom shifts must be 12h or under — split a longer window into two requests.");
      return;
    }
    const kind = customRequestKind(startTime);
    const date = customRequestDate;
    setCustomRequestRunning(true);
    try {
      // Reuse a matching ad-hoc shift type if this exact window has been requested
      // before; otherwise create one on the fly so hours/payroll still add up.
      const code = `CUSTOM-${startTime.replace(":", "")}-${endTime.replace(":", "")}`;
      let shiftTypeId = (shiftTypes ?? []).find((s) => s.code === code)?.id;
      if (!shiftTypeId) {
        const { data, error } = await supabase.from("shift_types").insert({
          tenant_id: profile.tenant_id,
          code,
          label: `Custom ${startTime}–${endTime}`,
          period: kind,
          default_hours: hours,
          pay_rule: "standard",
          active: true,
          is_leave: false,
        }).select("id").single();
        if (error) throw error;
        shiftTypeId = data.id;
        await qc.invalidateQueries({ queryKey: ["shift-types"] });
      }

      const wkKey = isoWeekKey(parseIsoDate(date));
      const editedKeys = new Set(Object.keys(edits));
      const empWeekHours = new Map<string, number>();
      const empWeekDays = new Map<string, Set<string>>();
      const empKindByDate = new Map<string, "day" | "night">();
      const busyToday = new Set<string>();
      const kindOfShift = (sid: string): "day" | "night" | null => {
        const st = shiftTypeById.get(sid);
        if (!st) return null;
        if (st.period === "night") return "night";
        if (st.period === "day" || st.period === "full_day" || st.period === "morning") return "day";
        return null;
      };
      const markWorked = (empId: string, d: string) => {
        const wk = `${empId}|${isoWeekKey(parseIsoDate(d))}`;
        if (!empWeekDays.has(wk)) empWeekDays.set(wk, new Set());
        empWeekDays.get(wk)!.add(d);
      };
      (weekAssignments ?? []).forEach((a) => {
        const k = `${a.employee_id}|${a.date}`;
        const sid = editedKeys.has(k) ? edits[k] : a.shift_type_id;
        if (!sid) return;
        const kindOf = kindOfShift(sid);
        if (kindOf) empKindByDate.set(k, kindOf);
        markWorked(a.employee_id, a.date);
        if (a.date === date) busyToday.add(a.employee_id);
        const wk = `${a.employee_id}|${isoWeekKey(parseIsoDate(a.date))}`;
        empWeekHours.set(wk, (empWeekHours.get(wk) ?? 0) + Number(a.planned_hours));
      });
      Object.entries(edits).forEach(([k, sid]) => {
        const [empId, d] = k.split("|");
        if (!sid) return;
        const st = shiftTypeById.get(sid);
        if (!st) return;
        const kindOf = kindOfShift(sid);
        if (kindOf) empKindByDate.set(k, kindOf);
        markWorked(empId, d);
        if (d === date) busyToday.add(empId);
        const wk = `${empId}|${isoWeekKey(parseIsoDate(d))}`;
        empWeekHours.set(wk, (empWeekHours.get(wk) ?? 0) + st.default_hours);
      });

      const buildPool = (requirePreference: boolean) => (employees ?? []).filter((emp) => {
        if (emp.status !== "active") return false;
        if (requirePreference && emp.preferred_shift !== kind && emp.preferred_shift !== "both") return false;
        if (busyToday.has(emp.id)) return false;
        const hrs = empWeekHours.get(`${emp.id}|${wkKey}`) ?? 0;
        if (hrs + hours > WEEKLY_HOUR_CAP) return false;
        const workedDays = empWeekDays.get(`${emp.id}|${wkKey}`)?.size ?? 0;
        if (workedDays >= MAX_WORKING_DAYS_PER_WEEK) return false;
        if (kind === "day" && empKindByDate.get(`${emp.id}|${isoDateAdd(date, -1)}`) === "night") return false;
        if (kind === "night" && empKindByDate.get(`${emp.id}|${isoDateAdd(date, 1)}`) === "day") return false;
        return true;
      });

      const requiredGrade = sites?.find((s) => s.id === siteId)?.required_guard_grade ?? null;
      const sortPool = (arr: NonNullable<typeof employees>) => arr.sort((a, b) => {
        const aFit = gradeFitScore(a.literacy_grade, requiredGrade);
        const bFit = gradeFitScore(b.literacy_grade, requiredGrade);
        if (aFit !== bFit) return aFit - bFit;
        const aHome = a.home_site_id === siteId ? 0 : 1;
        const bHome = b.home_site_id === siteId ? 0 : 1;
        if (aHome !== bHome) return aHome - bHome;
        const aCost = estimateShiftCost(a.hourly_rate, hours, 0, "standard", kind === "night", SCHED_CONSTANTS);
        const bCost = estimateShiftCost(b.hourly_rate, hours, 0, "standard", kind === "night", SCHED_CONSTANTS);
        return aCost - bCost;
      });

      // Preference-matching guards first; only reach into off-preference guards
      // if that still leaves the request short (shortage overrides preference).
      const chosen = sortPool(buildPool(true)).slice(0, needed);
      let offPreferenceCount = 0;
      if (chosen.length < needed) {
        const chosenIds = new Set(chosen.map((e) => e.id));
        const extra = sortPool(buildPool(false)).filter((e) => !chosenIds.has(e.id)).slice(0, needed - chosen.length);
        offPreferenceCount = extra.length;
        chosen.push(...extra);
      }
      if (chosen.length === 0) {
        toast.warning("No eligible guards available for this window — check weekly hours and rest days.");
        return;
      }
      const rows = chosen.map((emp) => ({
        tenant_id: profile.tenant_id, employee_id: emp.id, site_id: siteId,
        date, shift_type_id: shiftTypeId!, planned_hours: hours,
      }));
      const { error } = await supabase.from("schedule_assignments").insert(rows);
      if (error) throw error;

      const msg = `Custom request: assigned ${chosen.length}/${needed} guard${needed === 1 ? "" : "s"} for ${date} ${startTime}–${endTime}`
        + (offPreferenceCount > 0 ? ` · ${offPreferenceCount} against shift preference` : "");
      if (chosen.length < needed || offPreferenceCount > 0) toast.warning(`${msg}${chosen.length < needed ? " — not enough eligible guards for the rest" : ""}`);
      else toast.success(msg);

      setCustomRequestDate(null);
      await Promise.all([
        refetchAssignments(),
        qc.invalidateQueries({ queryKey: ["assignments-all"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Custom request failed");
    } finally {
      setCustomRequestRunning(false);
    }
  }

  // ── Print one duty-roster PDF page per guard for the chosen range ────────
  async function printSchedules() {
    if (!genFrom || !genTo) { toast.error("Pick a start and end date"); return; }
    if (genFrom > genTo) { toast.error("Start date must be on or before the end date"); return; }
    setPrinting(true);
    try {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("employee_id, site_id, date, shift_type_id, planned_hours")
        .gte("date", genFrom).lte("date", genTo);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) { toast.info("No shifts scheduled in this range yet."); return; }

      const siteById = new Map((sites ?? []).map((s) => [s.id, s]));
      const empById = new Map((employees ?? []).map((e) => [e.id, e]));
      const byEmp = new Map<string, { date: string; shiftLabel: string; shiftCode: string; hours: number; siteName: string }[]>();
      for (const r of rows) {
        const st = shiftTypeById.get(r.shift_type_id);
        const site = siteById.get(r.site_id);
        const list = byEmp.get(r.employee_id) ?? [];
        list.push({
          date: r.date,
          shiftLabel: st?.label ?? "Shift",
          shiftCode: st?.code ?? "",
          hours: Number(r.planned_hours),
          siteName: site?.name ?? "—",
        });
        byEmp.set(r.employee_id, list);
      }

      const employeesWithShifts = Array.from(byEmp.keys())
        .map((id) => empById.get(id))
        .filter((e): e is Employee => !!e)
        .sort((a, b) => a.surname.localeCompare(b.surname));
      if (employeesWithShifts.length === 0) { toast.info("No matching active employees found for these shifts."); return; }

      const pdf = buildScheduleSheetsPDF({
        employees: employeesWithShifts.map((e) => ({
          id: e.id, employee_code: e.employee_code, surname: e.surname, first_names: e.first_names,
        })),
        assignmentsByEmployee: byEmp,
        rangeStart: genFrom,
        rangeEnd: genTo,
        tenantName: tenant?.name ?? "Demo Payroll System",
      });
      pdf.save(`Guard_Schedules_${genFrom}_to_${genTo}.pdf`);
      toast.success(`Printed ${employeesWithShifts.length} guard schedule${employeesWithShifts.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  const today = new Date();
  const stats = useMemo(() => {
    let totalShifts = 0;
    let totalHours = 0;
    let estimatedWeeklyCost = 0;
    const dayCounts = days.map(() => 0);
    const empOrdHrs = new Map<string, number>();
    siteEmployees.forEach((emp) => {
      days.forEach((d, i) => {
        const date = fmtIso(d);
        const sid = effectiveShiftId(emp.id, date);
        if (!sid) return;
        const st = shiftTypeById.get(sid);
        if (!st) return;
        totalShifts += 1;
        totalHours += st.default_hours;
        dayCounts[i] += 1;
        const isSunday = d.getDay() === 0;
        const isPH = publicHolidayDates.has(date);
        const payRule = isPH ? "public_holiday_ordinary" : isSunday ? "sunday_default" : st.pay_rule;
        const ordHrs = empOrdHrs.get(emp.id) ?? 0;
        const shiftCost = estimateShiftCost(
          emp.hourly_rate, st.default_hours, ordHrs, payRule, st.period === "night", SCHED_CONSTANTS,
          emp.ordinarily_works_sundays,
        );
        estimatedWeeklyCost = round2(estimatedWeeklyCost + shiftCost);
        if (payRule === "standard") empOrdHrs.set(emp.id, ordHrs + st.default_hours);
      });
    });
    return { totalShifts, totalHours, dayCounts, estimatedWeeklyCost };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, siteEmployees, edits, assignments, shiftTypeById, publicHolidayDates]);

  const weekLabel = `${days[0].toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${days[6].toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  const activeSite = sites?.find((s) => s.id === activeSiteId) ?? null;

  // Modal cell context
  const modalEmp = modal && employees ? employees.find((e) => e.id === modal.empId) ?? null : null;
  const modalDate = modal ? new Date(modal.date) : null;
  const modalCurrentShiftId = modal ? effectiveShiftId(modal.empId, modal.date) : null;

  const guardMonthEmp = guardMonthEmpId && employees
    ? employees.find((e) => e.id === guardMonthEmpId) ?? null
    : null;
  const guardMonthLabel = guardMonthCursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const guardMonthHours = (guardMonthAssignments ?? []).reduce((sum, a) => sum + Number(a.planned_hours), 0);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" /> Schedule
            {dirtyCount > 0 && (
              <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-1 rounded">
                {dirtyCount} unsaved
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Click any cell to assign a shift. Colors show the shift kind at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-mono text-sm font-semibold px-3 py-2 rounded-md border min-w-[200px] text-center">
            {weekLabel}
          </div>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Roster
          </Button>
        </div>
      </div>

      {/* Custom date-range generate + print */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
          <Input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
          <Input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className="h-9 w-40" />
        </div>
        <Button variant="outline" onClick={generateSchedule} disabled={generating || weekAssignmentsFetching}>
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          Generate schedule for range
        </Button>
        <Button
          variant="outline"
          onClick={undoRange}
          disabled={undoing || !genFrom || !genTo}
          title={!genFrom || !genTo ? "Pick a date range first" : "Remove all shifts in the selected range"}
        >
          {undoing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Undo2 className="h-4 w-4 mr-2" />}
          Remove shifts in range
        </Button>
        <Button variant="outline" onClick={printSchedules} disabled={printing}>
          {printing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
          Print guard schedules
        </Button>
        <p className="text-xs text-muted-foreground basis-full">
          Generate fills gaps against site requirements across all sites for the chosen period. Remove deletes every shift in that same range, including manual edits. Print produces one duty-roster page per guard to hand out.
        </p>
      </Card>

      {/* Site tabs */}
      {sites && sites.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b">
          {sites.map((s) => {
            const count = (employees ?? []).filter((e) => e.home_site_id === s.id).length;
            const isActive = activeSiteId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSiteId(s.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  isActive
                    ? "border-accent text-accent-foreground bg-accent/10"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {s.name}
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-semibold",
                  isActive ? "bg-accent/30" : "bg-muted"
                )}>
                  {count} guards
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter guards…"
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Legend dot="bg-amber-400"   label="Day" />
            <Legend dot="bg-indigo-500"  label="Night" />
            <Legend dot="bg-emerald-500" label="Double" />
            <Legend dot="bg-slate-400"   label="Leave" />
            <Legend dot="" border label="Unassigned" />
          </div>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={autoFillRoster}
          disabled={autoFilling || (!autoShiftTypes.day && !autoShiftTypes.night)}
          title={(!autoShiftTypes.day && !autoShiftTypes.night) ? "Add a standard day/night shift template first" : "Auto-fill from site requirements"}
        >
          {autoFilling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Auto-fill this week
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={<Users className="h-5 w-5" />} value={siteEmployees.length} label="Guards on site" />
        <StatCard icon={<ListChecks className="h-5 w-5" />} value={stats.totalShifts} label="Shifts this week" />
        <StatCard icon={<Clock className="h-5 w-5" />} value={`${stats.totalHours}h`} label="Total hours" />
        <StatCard icon={<DollarSign className="h-5 w-5" />} value={formatNAD(stats.estimatedWeeklyCost)} label="Est. payroll cost" />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          value={shortfallPreview.length === 0 ? "OK" : `${shortfallPreview.length} gaps`}
          label="Coverage status"
          tone={shortfallPreview.length === 0 ? "success" : "destructive"}
        />
      </div>

      {/* Shortfalls */}
      {shortfallPreview.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <div className="p-3 flex items-center gap-2 border-b border-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="text-sm font-semibold text-destructive">
              {shortfallPreview.reduce((s, x) => s + x.short, 0)} guard-slot{shortfallPreview.reduce((s, x) => s + x.short, 0) === 1 ? "" : "s"} short — HR must resolve (no auto-OT)
            </div>
          </div>
          <div className="p-3 space-y-1 max-h-40 overflow-y-auto text-xs font-mono">
            {shortfallPreview.map((s, i) => {
              const site = sites?.find((x) => x.id === s.siteId);
              const d = new Date(s.date);
              return (
                <div key={i} className="flex items-center justify-between">
                  <span>
                    <span className="font-semibold">{site?.name ?? s.siteId}</span>
                    {" · "}{d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                    {" · "}<span className="uppercase">{s.kind}</span>
                  </span>
                  <span className="text-destructive font-bold">
                    {s.have}/{s.required} · short {s.short}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {qualityWarningPreview.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <div className="p-3 flex items-center gap-2 border-b border-warning/20">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <div className="text-sm font-semibold text-warning">
              {qualityWarningPreview.length} shift{qualityWarningPreview.length === 1 ? "" : "s"} filled below required grade
            </div>
          </div>
          <div className="p-3 space-y-1 max-h-40 overflow-y-auto text-xs font-mono">
            {qualityWarningPreview.map((w, i) => {
              const site = sites?.find((x) => x.id === w.siteId);
              const d = new Date(w.date);
              return (
                <div key={i} className="flex items-center justify-between">
                  <span>
                    <span className="font-semibold">{site?.name ?? w.siteId}</span>
                    {" · "}{d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                    {" · "}<span className="uppercase">{w.kind}</span>
                    {" · "}{w.employeeName}
                  </span>
                  <span className="text-warning font-bold">
                    needs {w.requiredGrade}, got {w.assignedGrade}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {blocking.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Roster cannot be saved — {blocking.length} weekly cap breach{blocking.length === 1 ? "" : "es"}</AlertTitle>
          <AlertDescription>
            One or more guards exceed the 60-hour weekly limit and have no PS exemption on file.
            File a PS exemption from the employee profile, or reduce hours.
          </AlertDescription>
        </Alert>
      )}

      {/* Schedule grid */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 min-w-[900px]">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-left px-4 py-3 text-[11px] uppercase font-semibold text-muted-foreground tracking-wider sticky left-0 bg-muted/40 z-10 min-w-[200px]">
                  Guard
                </th>
                <th className="text-center px-2 py-3 text-[11px] uppercase font-semibold text-muted-foreground tracking-wider min-w-[64px]">
                  Wk hrs
                </th>
                {days.map((d) => {
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = sameDate(d, today);
                  return (
                    <th key={fmtIso(d)} className={cn(
                      "px-2 py-2 min-w-[120px] border-l text-center",
                      isWeekend && "bg-muted/60"
                    )}>
                      <div className={cn(
                        "text-[10px] uppercase font-semibold tracking-wider",
                        isWeekend ? "text-muted-foreground/70" : "text-muted-foreground"
                      )}>
                        {d.toLocaleDateString("en-GB", { weekday: "short" })}
                      </div>
                      <div className="mt-1 flex items-center justify-center">
                        <button
                          onClick={() => setCustomRequestDate(fmtIso(d))}
                          title="Add a custom one-off guard request for this date"
                          className={cn(
                            "text-xl font-bold leading-none hover:text-accent transition-colors",
                            isToday && "inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent text-accent-foreground text-base hover:text-accent-foreground"
                          )}
                        >
                          {d.getDate()}
                        </button>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {d.toLocaleDateString("en-GB", { month: "short" })}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {siteEmployees.length === 0 && (
                <tr>
                  <td colSpan={days.length + 2} className="text-center py-12 text-muted-foreground text-sm">
                    No guards assigned to this site yet. Set <span className="font-mono">home_site</span> on employees,
                    or use Auto-fill to pull guards in based on requirements.
                  </td>
                </tr>
              )}
              {siteEmployees.map((emp) => {
                const empBreaches = breaches.filter((b) => b.empId === emp.id);
                const wkHours = weeklyTotals.get(`${emp.id}|${isoWeekKey(weekStart)}`) ?? 0;
                const overCap = empBreaches.length > 0;
                const blockedHere = empBreaches.some((b) => !b.covered);
                return (
                  <tr key={emp.id} className="group hover:bg-muted/20">
                    <td className="px-4 py-2 sticky left-0 bg-card group-hover:bg-muted/20 border-t border-border/50 z-10">
                      <button
                        onClick={() => { setGuardMonthCursor(startOfMonth(weekStart)); setGuardMonthEmpId(emp.id); }}
                        className="font-semibold text-sm leading-tight hover:underline hover:text-accent text-left"
                        title="View this guard's full month"
                      >
                        {emp.surname}, {emp.first_names}
                      </button>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {emp.employee_code}
                        {emp.preferred_shift !== "both" && (
                          <span className="ml-2 uppercase opacity-70">{emp.preferred_shift}-only</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center border-t border-border/50">
                      <span className={cn(
                        "inline-block text-xs font-bold px-2 py-1 rounded-md",
                        blockedHere ? "bg-destructive/20 text-destructive"
                          : overCap ? "bg-amber-100 text-amber-900"
                          : wkHours > 48 ? "bg-amber-50 text-amber-800"
                          : "bg-muted text-foreground"
                      )}>
                        {wkHours}h
                        {overCap && (
                          <span className="ml-1 text-[9px] uppercase">
                            {blockedHere ? "over" : "ps"}
                          </span>
                        )}
                      </span>
                    </td>
                    {days.map((d) => {
                      const date = fmtIso(d);
                      const k = `${emp.id}|${date}`;
                      const sid = effectiveShiftId(emp.id, date);
                      const st = sid ? shiftTypeById.get(sid) : null;
                      const kind = shiftKindOf(st);
                      const styles = KIND_STYLES[kind];
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const dirty = k in edits;
                      return (
                        <td key={date} className={cn(
                          "p-1.5 border-t border-l border-border/50 align-middle",
                          isWeekend && "bg-muted/30"
                        )}>
                          {st ? (
                            <button
                              onClick={() => setModal({ empId: emp.id, date })}
                              className={cn(
                                "w-full min-h-[58px] rounded-lg border px-2 py-1.5 flex flex-col items-start justify-center gap-0.5 transition-all hover:shadow-md hover:-translate-y-0.5",
                                styles.block,
                                dirty && "ring-2 ring-amber-400 ring-offset-1"
                              )}
                            >
                              <span className={cn("text-[9px] font-bold uppercase tracking-wider", styles.label)}>
                                {st.label.length > 14 ? st.code : st.label}
                              </span>
                              <span className="text-xs font-bold text-foreground font-mono">
                                {st.default_hours}h
                              </span>
                              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", styles.pill)}>
                                {st.code}
                              </span>
                            </button>
                          ) : (
                            <button
                              onClick={() => setModal({ empId: emp.id, date })}
                              className={cn(
                                "group/cell w-full min-h-[58px] rounded-lg border-2 border-dashed flex items-center justify-center transition-all",
                                "border-border hover:border-accent hover:bg-accent/5",
                                dirty && "border-amber-400 bg-amber-50"
                              )}
                            >
                              <Plus className="h-4 w-4 text-muted-foreground/40 group-hover/cell:text-accent transition-colors" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Summary row */}
              {siteEmployees.length > 0 && (
                <tr className="bg-muted/30">
                  <td className="px-4 py-3 sticky left-0 bg-muted/30 border-t-2 border-border z-10">
                    <div className="text-[11px] uppercase font-bold text-muted-foreground tracking-wider">
                      Guards on duty
                    </div>
                  </td>
                  <td className="border-t-2 border-border" />
                  {days.map((d, i) => {
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const count = stats.dayCounts[i];
                    // Compute required-for-this-day across the active site only (display hint)
                    const dow = d.getDay();
                    const req = (requirements ?? [])
                      .filter((r) => r.site_id === activeSiteId && r.day_of_week === dow)
                      .reduce((sum, r) => sum + r.quantity_required, 0);
                    const short = req > 0 && count < req;
                    return (
                      <td key={fmtIso(d)} className={cn(
                        "px-2 py-3 border-t-2 border-l border-border text-center",
                        isWeekend && "bg-muted/50"
                      )}>
                        <div className={cn(
                          "text-2xl font-extrabold leading-none",
                          short ? "text-destructive" : "text-foreground"
                        )}>
                          {count}{req > 0 && <span className="text-sm text-muted-foreground font-normal">/{req}</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-medium mt-1">
                          guards
                        </div>
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur p-4 shadow-lg">
        <div className="text-sm flex items-center gap-3 text-muted-foreground">
          <CalendarRange className="h-4 w-4" />
          {dirtyCount === 0 ? "All changes saved" : `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`}
          {blocking.length === 0 && dirtyCount > 0 && (
            <span className="flex items-center gap-1 text-success">
              <ShieldCheck className="h-3.5 w-3.5" /> Within weekly limits
            </span>
          )}
          {activeSite && <span>· Site: <span className="font-semibold text-foreground">{activeSite.name}</span></span>}
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setEdits({})}>
              <Eraser className="h-4 w-4 mr-1.5" /> Discard
            </Button>
          )}
          <Button onClick={save} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save roster
          </Button>
        </div>
      </div>

      {/* Assign modal */}
      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-md">
          {modal && modalEmp && modalDate && (
            <>
              <DialogHeader>
                <DialogTitle>{modalEmp.surname}, {modalEmp.first_names}</DialogTitle>
                <DialogDescription>
                  <span className="font-mono">{modalEmp.employee_code}</span>
                  {" · "}
                  {modalDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {(shiftTypes ?? []).map((st) => {
                  const kind = shiftKindOf(st);
                  const styles = KIND_STYLES[kind];
                  const selected = modalCurrentShiftId === st.id;
                  return (
                    <button
                      key={st.id}
                      onClick={() => { setCell(modal.empId, modal.date, st.id); setModal(null); }}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all text-left",
                        styles.block,
                        selected ? "ring-2 ring-accent ring-offset-1" : ""
                      )}
                    >
                      <div>
                        <div className="text-sm font-bold text-foreground">{st.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {st.code} · {st.pay_rule}
                        </div>
                      </div>
                      <span className={cn("text-xs font-bold px-2 py-1 rounded-full", styles.pill)}>
                        {st.default_hours}h
                      </span>
                    </button>
                  );
                })}
                {modalCurrentShiftId && (
                  <button
                    onClick={() => { setCell(modal.empId, modal.date, ""); setModal(null); }}
                    className="w-full flex items-center justify-between p-3 rounded-lg border-2 border-border bg-muted/30 hover:bg-muted/60 transition-all text-left"
                  >
                    <div>
                      <div className="text-sm font-bold text-muted-foreground">Clear shift</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Remove this assignment</div>
                    </div>
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Guard month view */}
      <Dialog open={!!guardMonthEmpId} onOpenChange={(o) => !o && setGuardMonthEmpId(null)}>
        <DialogContent className="max-w-3xl">
          {guardMonthEmp && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <DialogTitle>{guardMonthEmp.surname}, {guardMonthEmp.first_names}</DialogTitle>
                    <DialogDescription>
                      <span className="font-mono">{guardMonthEmp.employee_code}</span>
                      {" · "}{guardMonthFetching ? "loading…" : `${guardMonthHours}h posted this month`}
                    </DialogDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => setGuardMonthCursor((c) => addMonths(c, -1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="font-mono text-sm font-semibold min-w-[140px] text-center">{guardMonthLabel}</div>
                    <Button variant="outline" size="icon" onClick={() => setGuardMonthCursor((c) => addMonths(c, 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="grid grid-cols-7 gap-1.5">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="text-center text-[10px] uppercase font-semibold text-muted-foreground tracking-wider py-1">
                    {d}
                  </div>
                ))}
                {guardMonthWeeks.flat().map((d) => {
                  const date = fmtIso(d);
                  const inMonth = d.getMonth() === guardMonthCursor.getMonth();
                  const a = guardMonthByDate.get(date);
                  const st = a ? shiftTypeById.get(a.shift_type_id) : null;
                  const kind = shiftKindOf(st);
                  const styles = KIND_STYLES[kind];
                  const site = a ? sites?.find((s) => s.id === a.site_id) : null;
                  const isToday = sameDate(d, new Date());
                  return (
                    <div
                      key={date}
                      className={cn(
                        "min-h-[68px] rounded-lg border p-1.5 flex flex-col gap-0.5",
                        inMonth ? "border-border" : "border-transparent opacity-35",
                        isToday && "ring-2 ring-accent ring-offset-1",
                        st && inMonth && styles.block
                      )}
                    >
                      <span className="text-[10px] font-semibold text-muted-foreground">{d.getDate()}</span>
                      {st && inMonth && (
                        <>
                          <span className={cn("text-[10px] font-bold uppercase truncate", styles.label)}>
                            {site?.code ?? site?.name ?? "—"}
                          </span>
                          <span className={cn("text-[10px] font-semibold px-1 py-0.5 rounded self-start", styles.pill)}>
                            {st.code} · {st.default_hours}h
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGuardMonthEmpId(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Custom one-off request for a single date — e.g. an event needing 11pm–5am coverage */}
      <Dialog open={!!customRequestDate} onOpenChange={(o) => !o && setCustomRequestDate(null)}>
        <DialogContent className="max-w-md">
          {customRequestDate && (
            <>
              <DialogHeader>
                <DialogTitle>Custom request</DialogTitle>
                <DialogDescription>
                  {new Date(customRequestDate).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
                  {" · "}one-off coverage outside the normal Day/Night pattern — e.g. an event.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Site *</Label>
                  <Select
                    value={customRequest.siteId}
                    onValueChange={(v) => setCustomRequest((p) => ({ ...p, siteId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a site…" /></SelectTrigger>
                    <SelectContent>
                      {(sites ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Start time *</Label>
                    <Input
                      type="time"
                      value={customRequest.startTime}
                      onChange={(e) => setCustomRequest((p) => ({ ...p, startTime: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End time *</Label>
                    <Input
                      type="time"
                      value={customRequest.endTime}
                      onChange={(e) => setCustomRequest((p) => ({ ...p, endTime: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Guards needed *</Label>
                  <Input
                    type="number" min={1} step={1}
                    value={customRequest.guardsNeeded}
                    onChange={(e) => setCustomRequest((p) => ({ ...p, guardsNeeded: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {customRequestHours(customRequest.startTime, customRequest.endTime)}h shift · cheapest eligible guards are assigned automatically, respecting the 60h weekly cap and rest-day rules.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCustomRequestDate(null)}>Cancel</Button>
                <Button onClick={submitCustomRequest} disabled={customRequestRunning || !customRequest.siteId}>
                  {customRequestRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  Generate
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon, value, label, tone }: { icon: React.ReactNode; value: React.ReactNode; label: string; tone?: "success" | "destructive" }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={cn(
        "h-10 w-10 rounded-lg flex items-center justify-center",
        tone === "success" ? "bg-success/15 text-success"
          : tone === "destructive" ? "bg-destructive/15 text-destructive"
          : "bg-accent/15 text-accent-foreground"
      )}>
        {icon}
      </div>
      <div>
        <div className={cn(
          "text-2xl font-extrabold leading-none",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive"
        )}>
          {value}
        </div>
        <div className="text-xs text-muted-foreground font-medium mt-1">{label}</div>
      </div>
    </Card>
  );
}

function Legend({ dot, label, border }: { dot: string; label: string; border?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 font-medium">
      <span className={cn(
        "w-2.5 h-2.5 rounded",
        dot,
        border && "border-2 border-dashed border-muted-foreground/40"
      )} />
      {label}
    </span>
  );
}
