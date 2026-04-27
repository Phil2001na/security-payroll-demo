import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChevronLeft, ChevronRight, Save, AlertTriangle,
  Loader2, Search, ShieldCheck, Eraser, Users, Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/schedule")({
  component: SchedulePage,
  head: () => ({ meta: [{ title: "Schedule — Dog Force Payroll" }] }),
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
type Site = { id: string; name: string; code: string | null };
type Employee = {
  id: string; employee_code: string; surname: string; first_names: string;
  home_site_id: string | null; status: string;
  preferred_shift: "day" | "night" | "both";
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
};

const WEEKLY_HOUR_CAP = 60;

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtIso(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysInMonth(d: Date) {
  const out: Date[] = [];
  const last = endOfMonth(d).getDate();
  for (let i = 1; i <= last; i++) out.push(new Date(d.getFullYear(), d.getMonth(), i));
  return out;
}
function isoWeekKey(d: Date) {
  // ISO week: Mon = first day. Match Postgres date_trunc('week', x).
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7; // 0=Mon
  tmp.setUTCDate(tmp.getUTCDate() - dayNum);
  return fmtIso(tmp);
}

function SchedulePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [search, setSearch] = useState("");
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  // Pending edits: key = `${employeeId}|${date}` -> shift_type_id (empty string = clear)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const monthStart = fmtIso(month);
  const monthEnd = fmtIso(endOfMonth(month));
  const days = useMemo(() => daysInMonth(month), [month]);

  const { data: sites } = useQuery<Site[]>({
    queryKey: ["sites", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites").select("id, name, code").eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!activeSiteId && sites && sites.length) setActiveSiteId(sites[0].id);
  }, [sites, activeSiteId]);

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
        .select("id, employee_code, surname, first_names, home_site_id, status, preferred_shift")
        .eq("status", "active")
        .order("surname");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });

  const { data: assignments, refetch: refetchAssignments } = useQuery<Assignment[]>({
    queryKey: ["assignments", profile?.tenant_id, monthStart, monthEnd, activeSiteId],
    enabled: !!profile?.tenant_id && !!activeSiteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .eq("site_id", activeSiteId!)
        .gte("date", monthStart).lte("date", monthEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Need *all* assignments across all sites to compute weekly totals correctly per employee.
  const { data: weekAssignments } = useQuery<Assignment[]>({
    queryKey: ["assignments-all", profile?.tenant_id, monthStart, monthEnd],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
        .gte("date", monthStart).lte("date", monthEnd);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: exemptions } = useQuery<PSExemption[]>({
    queryKey: ["ps-exemptions", profile?.tenant_id, monthStart, monthEnd],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ps_exemptions")
        .select("id, employee_id, effective_from, effective_to, reference")
        .lte("effective_from", monthEnd).gte("effective_to", monthStart);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Manpower requirements across all sites in the tenant.
  const { data: requirements } = useQuery<SiteRequirement[]>({
    queryKey: ["site-requirements-all", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_requirements")
        .select("site_id, day_of_week, shift_kind, quantity_required");
      if (error) throw error;
      return (data ?? []) as SiteRequirement[];
    },
  });
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

  // Lookup helpers
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

  // Combine saved + pending into "effective" cell view
  function effectiveShiftId(empId: string, date: string): string | null {
    const k = `${empId}|${date}`;
    if (k in edits) return edits[k] || null;
    const a = assignByKey.get(k);
    return a ? a.shift_type_id : null;
  }
  function effectiveHours(empId: string, date: string): number {
    const sid = effectiveShiftId(empId, date);
    if (!sid) return 0;
    return shiftTypeById.get(sid)?.default_hours ?? 0;
  }

  // Weekly totals per employee per ISO week. Combines:
  // - all DB assignments across all sites
  // - pending edits (overrides current site only)
  const weeklyTotals = useMemo(() => {
    const totals = new Map<string, number>(); // key: empId|isoWeekKey
    const editedKeys = new Set(Object.keys(edits));
    (weekAssignments ?? []).forEach((a) => {
      const k = `${a.employee_id}|${a.date}`;
      if (editedKeys.has(k)) return; // will be overridden
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

  function exemptionForWeek(empId: string, weekStart: Date): PSExemption | null {
    const wkStart = fmtIso(weekStart);
    const wkEnd = fmtIso(new Date(weekStart.getTime() + 6 * 86400000));
    return (exemptions ?? []).find((x) =>
      x.employee_id === empId && x.effective_from <= wkEnd && x.effective_to >= wkStart
    ) ?? null;
  }

  // Detect over-cap weeks per employee (and whether covered)
  type Breach = { empId: string; weekKey: string; hours: number; covered: boolean };
  const breaches = useMemo<Breach[]>(() => {
    const out: Breach[] = [];
    weeklyTotals.forEach((hours, key) => {
      if (hours <= WEEKLY_HOUR_CAP) return;
      const [empId, wk] = key.split("|");
      const wkStart = new Date(wk);
      const ex = exemptionForWeek(empId, wkStart);
      out.push({ empId, weekKey: wk, hours, covered: !!ex });
    });
    return out;
  }, [weeklyTotals, exemptions]);

  const blocking = breaches.filter((b) => !b.covered);
  const dirtyCount = Object.keys(edits).length;
  const canSave = dirtyCount > 0 && blocking.length === 0 && !saving;

  function setCell(empId: string, date: string, shiftId: string) {
    setEdits((prev) => {
      const next = { ...prev };
      const k = `${empId}|${date}`;
      const existing = assignByKey.get(k);
      if (existing && existing.shift_type_id === shiftId) {
        // Reverting to saved value -> drop the pending edit
        delete next[k];
      } else if (!existing && !shiftId) {
        delete next[k];
      } else {
        next[k] = shiftId;
      }
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
        if (!shiftId) {
          if (existing) deletes.push(existing.id);
          continue;
        }
        const st = shiftTypeById.get(shiftId);
        if (!st) continue;
        if (existing) {
          updates.push({ id: existing.id, shift_type_id: shiftId, planned_hours: st.default_hours });
        } else {
          inserts.push({
            tenant_id: profile.tenant_id,
            employee_id: empId,
            site_id: activeSiteId,
            date,
            shift_type_id: shiftId,
            planned_hours: st.default_hours,
          });
        }
      }

      if (deletes.length) {
        const { error } = await supabase.from("schedule_assignments").delete().in("id", deletes);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("schedule_assignments")
          .update({ shift_type_id: u.shift_type_id, planned_hours: u.planned_hours })
          .eq("id", u.id);
        if (error) throw error;
      }
      if (inserts.length) {
        // Chunk to 200
        for (let i = 0; i < inserts.length; i += 200) {
          const { error } = await supabase.from("schedule_assignments").insert(inserts.slice(i, i + 200));
          if (error) throw error;
        }
      }

      toast.success(`Roster saved · ${dirtyCount} changes`);
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

  // ========= Auto-Fill Roster =========
  // Week choices: ISO weeks overlapping the shown month.
  const weekOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string; start: Date; end: Date }[] = [];
    for (const d of days) {
      const k = isoWeekKey(d);
      if (seen.has(k)) continue;
      seen.add(k);
      const start = new Date(k);
      const end = new Date(start.getTime() + 6 * 86400000);
      out.push({
        key: k,
        label: `${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`,
        start, end,
      });
    }
    return out;
  }, [days]);

  const [fillWeek, setFillWeek] = useState<string>("");
  useEffect(() => {
    if (!fillWeek && weekOptions.length) {
      const today = isoWeekKey(new Date());
      const match = weekOptions.find((w) => w.key === today);
      setFillWeek(match ? match.key : weekOptions[0].key);
    }
  }, [weekOptions, fillWeek]);

  // Pick a standard "day" and "night" shift_type for auto-fill.
  const autoShiftTypes = useMemo(() => {
    const st = shiftTypes ?? [];
    const candidates = st.filter((s) =>
      s.active && !s.is_leave && s.default_hours > 0 && s.pay_rule === "standard"
    );
    const findBy = (periods: string[]) =>
      candidates.find((s) => periods.includes(s.period)) ?? null;
    const day = findBy(["day"]) ?? findBy(["full_day"]);
    const night = findBy(["night"]);
    return { day, night };
  }, [shiftTypes]);

  // Shortfall & auto-fill dry-run for the chosen week.
  type FillPlan = {
    shortfalls: { siteId: string; date: string; kind: "day" | "night"; required: number; have: number; short: number }[];
    newAssignments: { employee_id: string; site_id: string; date: string; shift_type_id: string; planned_hours: number }[];
    unassignable: number; // same as sum of shortfalls
  };

  function computeFillPlan(): FillPlan {
    const plan: FillPlan = { shortfalls: [], newAssignments: [], unassignable: 0 };
    if (!fillWeek || !sites || !employees || !requirements || !weekAssignments) return plan;
    if (!autoShiftTypes.day && !autoShiftTypes.night) return plan;

    const weekStart = new Date(fillWeek);
    const weekDates: { date: string; dow: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      weekDates.push({ date: fmtIso(d), dow: d.getDay() });
    }
    const weekDateSet = new Set(weekDates.map((w) => w.date));

    // Track per-employee: (a) dates already taken this week, (b) total hours this week
    const empDates = new Map<string, Set<string>>();
    const empWeekHours = new Map<string, number>();
    for (const emp of employees) {
      empDates.set(emp.id, new Set());
      empWeekHours.set(emp.id, 0);
    }
    // Apply existing saved assignments (+ pending edits override)
    const editedKeys = new Set(Object.keys(edits));
    for (const a of weekAssignments) {
      if (!weekDateSet.has(a.date)) continue;
      const k = `${a.employee_id}|${a.date}`;
      if (editedKeys.has(k)) continue;
      empDates.get(a.employee_id)?.add(a.date);
      empWeekHours.set(a.employee_id, (empWeekHours.get(a.employee_id) ?? 0) + Number(a.planned_hours));
    }
    for (const [k, sid] of Object.entries(edits)) {
      const [empId, date] = k.split("|");
      if (!weekDateSet.has(date)) continue;
      if (!sid) continue;
      const st = shiftTypeById.get(sid);
      if (!st) continue;
      empDates.get(empId)?.add(date);
      empWeekHours.set(empId, (empWeekHours.get(empId) ?? 0) + st.default_hours);
    }

    // Existing coverage per (site, date, kind)
    type CoverKey = string; // `${site}|${date}|${kind}`
    const coverage = new Map<CoverKey, number>();
    function effectiveKind(shiftId: string): "day" | "night" | null {
      const st = shiftTypeById.get(shiftId);
      if (!st) return null;
      if (st.period === "night") return "night";
      if (st.period === "day" || st.period === "full_day" || st.period === "morning") return "day";
      return null;
    }
    for (const a of weekAssignments) {
      if (!weekDateSet.has(a.date)) continue;
      const k = `${a.employee_id}|${a.date}`;
      const sid = editedKeys.has(k) ? edits[k] : a.shift_type_id;
      if (!sid) continue;
      const kind = effectiveKind(sid);
      if (!kind) continue;
      const ck = `${a.site_id}|${a.date}|${kind}`;
      coverage.set(ck, (coverage.get(ck) ?? 0) + 1);
    }
    // Pending inserts on currently-viewed site from edits (no existing row case)
    for (const [k, sid] of Object.entries(edits)) {
      const [empId, date] = k.split("|");
      if (!weekDateSet.has(date)) continue;
      if (!sid) continue;
      // Only count if there wasn't already a row (otherwise already handled above)
      const existing = (weekAssignments ?? []).find((a) => a.employee_id === empId && a.date === date);
      if (existing) continue;
      const kind = effectiveKind(sid);
      if (!kind || !activeSiteId) continue;
      const ck = `${activeSiteId}|${date}|${kind}`;
      coverage.set(ck, (coverage.get(ck) ?? 0) + 1);
    }

    // Iterate site x day x kind
    for (const site of sites) {
      for (const wd of weekDates) {
        for (const kind of ["day", "night"] as const) {
          const req = requirements.find(
            (r) => r.site_id === site.id && r.day_of_week === wd.dow && r.shift_kind === kind
          );
          const required = req?.quantity_required ?? 0;
          if (required === 0) continue;
          const stForKind = kind === "day" ? autoShiftTypes.day : autoShiftTypes.night;
          if (!stForKind) continue;
          const ck = `${site.id}|${wd.date}|${kind}`;
          let have = coverage.get(ck) ?? 0;
          const needed = required - have;
          if (needed <= 0) continue;

          // Candidate employees: active, preferred_shift matches, not already assigned that day,
          // and total weekly hours + shift hours <= 60.
          const shiftHours = stForKind.default_hours;
          const pool = employees.filter((emp) => {
            if (emp.status !== "active") return false;
            if (emp.preferred_shift !== kind && emp.preferred_shift !== "both") return false;
            const takenDates = empDates.get(emp.id);
            if (takenDates?.has(wd.date)) return false;
            const hrs = empWeekHours.get(emp.id) ?? 0;
            if (hrs + shiftHours > WEEKLY_HOUR_CAP) return false;
            return true;
          });
          // Prioritise: home_site match > "both" (specialists preserved) > lowest weekly hours
          pool.sort((a, b) => {
            const aHome = a.home_site_id === site.id ? 0 : 1;
            const bHome = b.home_site_id === site.id ? 0 : 1;
            if (aHome !== bHome) return aHome - bHome;
            const aSpec = a.preferred_shift === kind ? 1 : 0; // prefer specialists LAST so "both" employees stay flexible
            const bSpec = b.preferred_shift === kind ? 1 : 0;
            // Actually we DO want specialists first for their kind (they can't work the other kind anyway).
            if (aSpec !== bSpec) return bSpec - aSpec;
            return (empWeekHours.get(a.id) ?? 0) - (empWeekHours.get(b.id) ?? 0);
          });

          let assigned = 0;
          for (const emp of pool) {
            if (assigned >= needed) break;
            plan.newAssignments.push({
              employee_id: emp.id,
              site_id: site.id,
              date: wd.date,
              shift_type_id: stForKind.id,
              planned_hours: shiftHours,
            });
            empDates.get(emp.id)?.add(wd.date);
            empWeekHours.set(emp.id, (empWeekHours.get(emp.id) ?? 0) + shiftHours);
            coverage.set(ck, (coverage.get(ck) ?? 0) + 1);
            have++;
            assigned++;
          }

          if (assigned < needed) {
            plan.shortfalls.push({
              siteId: site.id,
              date: wd.date,
              kind,
              required,
              have,
              short: needed - assigned,
            });
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
    const plan = computeFillPlan();
    if (plan.newAssignments.length === 0 && plan.shortfalls.length === 0) {
      toast.info("Nothing to fill — requirements already met or no requirements set.");
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
        + (plan.unassignable > 0 ? ` · ${plan.unassignable} slot${plan.unassignable === 1 ? "" : "s"} short — see below` : "");
      if (plan.unassignable > 0) toast.warning(msg);
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

  // Live shortfall preview (after pending edits) for indicator
  const shortfallPreview = useMemo(() => computeFillPlan().shortfalls,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fillWeek, sites, employees, requirements, weekAssignments, edits, autoShiftTypes, shiftTypeById, activeSiteId]
  );
    const k = `${empId}|${date}`;
    const sid = effectiveShiftId(empId, date);
    if (!sid) {
      return (k in edits && assignByKey.get(k)) ? { code: "—", hours: 0, pendingDelete: true, pendingChange: false } : null;
    }
    const st = shiftTypeById.get(sid);
    if (!st) return null;
    const dirty = k in edits;
    return { code: st.code, hours: st.default_hours, pendingDelete: false, pendingChange: dirty };
  }

  const monthLabel = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" /> Schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly roster grouped by site. Click a cell to assign a shift template.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-mono text-sm font-medium px-3 py-1.5 rounded-md border min-w-[140px] text-center">
            {monthLabel}
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        </div>
      </div>

      {/* Site tabs */}
      {sites && sites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b pb-2">
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSiteId(s.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                activeSiteId === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-transparent"
              )}
            >
              {s.name}
              {s.code && <span className="ml-1.5 text-xs opacity-60">{s.code}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter guards…"
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {siteEmployees.length} guards</span>
          {dirtyCount > 0 && <Badge variant="outline" className="font-mono">{dirtyCount} pending</Badge>}
          {blocking.length > 0 && (
            <Badge variant="destructive" className="font-mono">
              <AlertTriangle className="h-3 w-3 mr-1" /> {blocking.length} blocked
            </Badge>
          )}
        </div>
      </div>

      {blocking.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Roster cannot be saved — {blocking.length} weekly cap breach{blocking.length === 1 ? "" : "es"} without PS exemption</AlertTitle>
          <AlertDescription>
            One or more guards exceed the 60-hour weekly limit and have no PS exemption on file. File a PS exemption from the employee profile, or reduce hours.
          </AlertDescription>
        </Alert>
      )}

      {/* Grid */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-2 py-2 font-medium sticky left-0 bg-muted/50 z-20 border-b border-r min-w-[180px]">Guard</th>
                <th className="text-center px-2 py-2 font-medium border-b sticky left-[180px] bg-muted/50 z-20 border-r min-w-[60px]">Wk hrs</th>
                {days.map((d) => {
                  const dow = d.toLocaleDateString("en-GB", { weekday: "short" });
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th key={fmtIso(d)} className={cn(
                      "text-center px-1 py-1 font-mono font-medium border-b min-w-[44px]",
                      isWeekend && "bg-accent/10"
                    )}>
                      <div className="text-[10px] text-muted-foreground uppercase">{dow}</div>
                      <div className="text-sm">{d.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {siteEmployees.length === 0 && (
                <tr>
                  <td colSpan={days.length + 2} className="text-center py-12 text-muted-foreground">
                    No guards assigned to this site yet. Set <span className="font-mono">home_site</span> on employees, or assign a shift to add them here.
                  </td>
                </tr>
              )}
              {siteEmployees.map((emp) => {
                // Sum hours for the week of the FIRST day visible (header) — show per-week totals as we render days.
                return (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    days={days}
                    cellLabel={cellLabel}
                    setCell={setCell}
                    weeklyTotals={weeklyTotals}
                    breaches={breaches}
                    shiftTypes={shiftTypes ?? []}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur p-4 shadow-lg">
        <div className="text-sm flex items-center gap-3 text-muted-foreground">
          {dirtyCount === 0 ? "All changes saved" : `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`}
          {blocking.length === 0 && dirtyCount > 0 && (
            <span className="flex items-center gap-1 text-success"><ShieldCheck className="h-3.5 w-3.5" /> Within weekly limits</span>
          )}
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
    </div>
  );
}

type RowProps = {
  emp: Employee;
  days: Date[];
  cellLabel: (empId: string, date: string) => { code: string; hours: number; pendingDelete: boolean; pendingChange: boolean } | null;
  setCell: (empId: string, date: string, shiftId: string) => void;
  weeklyTotals: Map<string, number>;
  breaches: Array<{ empId: string; weekKey: string; hours: number; covered: boolean }>;
  shiftTypes: ShiftType[];
};

function EmployeeRow({ emp, days, cellLabel, setCell, weeklyTotals, breaches, shiftTypes }: RowProps) {
  // Show weekly hours for the ISO week containing the first day, but also color cells per their week
  const weekKeys = useMemo(() => days.map((d) => isoWeekKey(d)), [days]);
  const empBreaches = breaches.filter((b) => b.empId === emp.id);
  const maxWeekHours = Math.max(0, ...weekKeys.map((wk) => weeklyTotals.get(`${emp.id}|${wk}`) ?? 0));
  const overCap = empBreaches.length > 0;

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-2 py-1.5 sticky left-0 bg-background border-r border-b">
        <div className="font-medium text-sm leading-tight">{emp.surname}, {emp.first_names}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{emp.employee_code}</div>
      </td>
      <td className={cn(
        "px-2 py-1.5 text-center font-mono text-xs sticky left-[180px] bg-background border-r border-b",
        overCap && empBreaches.every((b) => b.covered) && "text-warning",
        overCap && empBreaches.some((b) => !b.covered) && "text-destructive font-bold"
      )}>
        {maxWeekHours.toFixed(0)}h
        {overCap && (
          <div className="text-[9px] uppercase tracking-wider">
            {empBreaches.some((b) => !b.covered) ? "over" : "ps"}
          </div>
        )}
      </td>
      {days.map((d) => {
        const date = fmtIso(d);
        const cell = cellLabel(emp.id, date);
        const wk = isoWeekKey(d);
        const wkHours = weeklyTotals.get(`${emp.id}|${wk}`) ?? 0;
        const cellInOverWeek = wkHours > WEEKLY_HOUR_CAP;
        const cellBreach = breaches.find((b) => b.empId === emp.id && b.weekKey === wk);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        return (
          <td key={date} className={cn(
            "p-0 border-b border-r/30 align-middle text-center",
            isWeekend && "bg-accent/5"
          )}>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "w-full h-9 px-1 text-[11px] font-mono font-medium hover:bg-primary/10 transition-colors",
                    cell?.pendingChange && "ring-1 ring-inset ring-warning",
                    cellInOverWeek && (cellBreach && !cellBreach.covered ? "bg-destructive/15" : "bg-warning/15")
                  )}
                  title={cell ? `${cell.code} · ${cell.hours}h` : "Empty"}
                >
                  {cell ? cell.code : <span className="text-muted-foreground/40">·</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="center">
                <div className="text-xs text-muted-foreground mb-2 px-1">
                  {emp.surname}, {emp.first_names} · {d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                </div>
                <Select
                  value={cell ? (shiftTypes.find((s) => s.code === cell.code)?.id ?? "") : ""}
                  onValueChange={(v) => setCell(emp.id, date, v)}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Pick shift…" /></SelectTrigger>
                  <SelectContent>
                    {shiftTypes.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-mono text-xs">{s.code}</span>
                        <span className="text-muted-foreground ml-2">{s.label} · {s.default_hours}h</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cell && (
                  <Button
                    size="sm" variant="ghost"
                    className="w-full mt-2 text-destructive hover:text-destructive"
                    onClick={() => setCell(emp.id, date, "")}
                  >
                    Clear cell
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </td>
        );
      })}
    </tr>
  );
}
