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

export const Route = createFileRoute("/_app/attendance")({
  component: AttendancePage,
  head: () => ({ meta: [{ title: "Daily Muster — Dog Force Payroll" }] }),
});

const WEEKLY_HOUR_CAP = 60;

type Site = { id: string; name: string; code: string | null };
type ShiftType = { id: string; code: string; label: string; default_hours: number };
type Employee = {
  id: string; employee_code: string; surname: string; first_names: string;
  home_site_id: string | null; status: string;
};
type Assignment = {
  id: string; employee_id: string; site_id: string; date: string;
  shift_type_id: string; planned_hours: number;
};
type ShiftLog = {
  id: string; employee_id: string; site_id: string; date: string;
  shift_type_id: string; pay_period_id: string; assignment_id: string | null;
  hours_worked: number; night_hours: number;
  status: "pending" | "approved" | "no_show" | "replaced_by_other" | "suspended_unpaid";
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
  const qc = useQueryClient();
  const [date, setDate] = useState(() => fmtIso(new Date()));
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Pending status changes by assignment.id
  const [pending, setPending] = useState<Record<string, { status: ShiftLog["status"]; notes?: string }>>({});
  const [replaceFor, setReplaceFor] = useState<Assignment | null>(null);
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
        .from("shift_types").select("id, code, label, default_hours")
        .eq("active", true).order("code");
      if (error) throw error;
      return (data ?? []) as ShiftType[];
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
        .select("id, employee_id, site_id, date, shift_type_id, planned_hours")
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
        .select("id, employee_code, surname, first_names, home_site_id, status")
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Week assignments to compute weekly hours for replacement candidates
  const { data: weekAssignments } = useQuery<Assignment[]>({
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

  // Filter assignments by site + search
  const visibleAssignments = useMemo(() => {
    let list = (assignments ?? []).slice();
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
  }, [assignments, siteFilter, search, empById, siteById]);

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

  function markAllPresent() {
    const updates: Record<string, { status: ShiftLog["status"] }> = { ...pending };
    let changed = 0;
    visibleAssignments.forEach((a) => {
      const cur = effectiveStatus(a);
      if (cur === "pending") {
        updates[a.id] = { status: "approved" };
        changed++;
      }
    });
    setPending(updates);
    toast.success(`Marked ${changed} guard${changed === 1 ? "" : "s"} present`);
  }

  // Stats
  const stats = useMemo(() => {
    const tot = visibleAssignments.length;
    let present = 0, absent = 0, replaced = 0, pendingC = 0;
    visibleAssignments.forEach((a) => {
      const s = effectiveStatus(a);
      if (s === "approved") present++;
      else if (s === "no_show") absent++;
      else if (s === "replaced_by_other") replaced++;
      else pendingC++;
    });
    return { tot, present, absent, replaced, pendingC };
  }, [visibleAssignments, pending, logByAssignment]);

  const dirtyCount = Object.keys(pending).length;
  const canConfirm = !!payPeriod && dirtyCount > 0 && !saving;

  async function confirm() {
    if (!profile?.tenant_id || !payPeriod) {
      toast.error("No open pay period for this date.");
      return;
    }
    setSaving(true);
    try {
      // Build per-assignment payloads
      const inserts: Array<Omit<ShiftLog, "id">> = [];
      const updates: Array<{ id: string; status: ShiftLog["status"]; hours_worked: number; notes: string | null }> = [];
      for (const [assignmentId, change] of Object.entries(pending)) {
        const a = assignments?.find((x) => x.id === assignmentId);
        if (!a) continue;
        const st = shiftById.get(a.shift_type_id);
        const hours = change.status === "approved" ? Number(a.planned_hours) : 0;
        // crude night detection: shift code ending in /NS or "Night"
        const nightHours = st && /night|N\/?S$/i.test(st.code + " " + st.label) && change.status === "approved" ? Number(a.planned_hours) : 0;
        const existing = logByAssignment.get(a.id);
        if (existing) {
          updates.push({ id: existing.id, status: change.status, hours_worked: hours, notes: change.notes ?? existing.notes });
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
            status: change.status,
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
      toast.success(`Attendance confirmed · ${dirtyCount} record${dirtyCount === 1 ? "" : "s"}`);
      setPending({});
      await refetchLogs();
      await qc.invalidateQueries({ queryKey: ["assignments-day"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setSaving(false);
    }
  }

  // ----- Replacement logic -----
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
        return { emp: e, weekBefore: wk, weekAfter: wkAfter };
      })
      .filter((c) => c.weekAfter <= WEEKLY_HOUR_CAP)
      .sort((a, b) => a.weekAfter - b.weekAfter)
      .slice(0, 25);
  }, [replaceFor, employees, assignments, weekHoursByEmp]);

  async function applyReplacement(reliefEmpId: string) {
    if (!replaceFor || !profile?.tenant_id || !payPeriod) return;
    setSaving(true);
    try {
      const a = replaceFor;
      const st = shiftById.get(a.shift_type_id);
      const nightHours = st && /night|N\/?S$/i.test(st.code + " " + st.label) ? Number(a.planned_hours) : 0;

      // 1. Mark the original assignment as "no_show" -> upsert log for absent guard with 0 hours
      const existingOriginalLog = logByAssignment.get(a.id);
      if (existingOriginalLog) {
        const { error } = await supabase.from("shift_logs")
          .update({ status: "no_show", hours_worked: 0, night_hours: 0 })
          .eq("id", existingOriginalLog.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shift_logs").insert({
          tenant_id: profile.tenant_id,
          employee_id: a.employee_id, site_id: a.site_id, date: a.date,
          shift_type_id: a.shift_type_id, pay_period_id: payPeriod.id,
          assignment_id: a.id, hours_worked: 0, night_hours: 0,
          status: "no_show", notes: "Absent — relief used",
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

      // 3. Insert a shift_log for the relief guard, paid the hours
      const { error: lErr } = await supabase.from("shift_logs").insert({
        tenant_id: profile.tenant_id,
        employee_id: reliefEmpId,
        site_id: a.site_id, date: a.date,
        shift_type_id: a.shift_type_id,
        pay_period_id: payPeriod.id,
        assignment_id: reliefAssignment.id,
        hours_worked: a.planned_hours,
        night_hours: nightHours,
        status: "approved",
        notes: `Relief — covering for ${empById.get(a.employee_id)?.surname ?? "absent guard"}`,
      });
      if (lErr) throw lErr;

      toast.success(`Relief assigned: ${empById.get(reliefEmpId)?.surname}`);
      setReplaceFor(null);
      await Promise.all([
        refetchLogs(),
        qc.invalidateQueries({ queryKey: ["assignments-day"] }),
        qc.invalidateQueries({ queryKey: ["assignments-week"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Replacement failed");
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
  const grouped = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    visibleAssignments.forEach((a) => {
      const arr = m.get(a.site_id) ?? [];
      arr.push(a);
      m.set(a.site_id, arr);
    });
    return Array.from(m.entries());
  }, [visibleAssignments]);

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
              {(sites ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={markAllPresent} disabled={stats.pendingC === 0}>
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark all present
          </Button>
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

      {/* Roster table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium border-b">Guard</th>
                <th className="px-3 py-2 font-medium border-b">Shift</th>
                <th className="px-3 py-2 font-medium border-b text-right">Hrs</th>
                <th className="px-3 py-2 font-medium border-b">Wk total</th>
                <th className="px-3 py-2 font-medium border-b">Status</th>
                <th className="px-3 py-2 font-medium border-b text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">
                  No shifts scheduled for this date{siteFilter !== "all" ? " at this site" : ""}.
                </td></tr>
              )}
              {grouped.map(([siteId, list]) => (
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
                  setReplaceFor={setReplaceFor}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur p-4 shadow-lg">
        <div className="text-sm flex items-center gap-2 text-muted-foreground">
          <Users className="h-4 w-4" />
          {dirtyCount === 0 ? "All changes saved" : `${dirtyCount} pending change${dirtyCount === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setPending({})}>Discard</Button>
          )}
          <Button onClick={confirm} disabled={!canConfirm}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Confirm attendance
          </Button>
        </div>
      </div>

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
                  {replacementCandidates.map(({ emp, weekBefore, weekAfter }) => (
                    <tr key={emp.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium">{emp.surname}, {emp.first_names}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{emp.employee_code}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{weekBefore.toFixed(0)}h</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={cn(weekAfter > 50 && "text-warning", weekAfter > 55 && "text-destructive")}>{weekAfter.toFixed(0)}h</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" onClick={() => applyReplacement(emp.id)} disabled={saving}>
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
                          Assign
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
  setReplaceFor: (a: Assignment) => void;
};

function SiteGroup({ siteName, count, list, empById, shiftById, weekHoursByEmp, effectiveStatus, pending, setStatus, setReplaceFor }: SiteGroupProps) {
  return (
    <>
      <tr className="bg-primary/5">
        <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {siteName} <span className="opacity-60 font-normal">· {count} guard{count === 1 ? "" : "s"}</span>
        </td>
      </tr>
      {list.map((a) => {
        const e = empById.get(a.employee_id);
        const st = shiftById.get(a.shift_type_id);
        const status = effectiveStatus(a);
        const wkHours = weekHoursByEmp.get(a.employee_id) ?? 0;
        const isDirty = a.id in pending;
        return (
          <tr key={a.id} className={cn("border-t hover:bg-muted/20", isDirty && "bg-warning/5")}>
            <td className="px-3 py-2">
              <div className="font-medium leading-tight">{e?.surname}, {e?.first_names}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{e?.employee_code}</div>
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
              <StatusBadge status={status} dirty={isDirty} />
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm" variant={status === "approved" ? "default" : "outline"}
                  className={cn("h-7 px-2", status === "approved" && "bg-success hover:bg-success/90 text-success-foreground")}
                  onClick={() => setStatus(a, "approved")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant={status === "no_show" ? "default" : "outline"}
                  className={cn("h-7 px-2", status === "no_show" && "bg-destructive hover:bg-destructive/90 text-destructive-foreground")}
                  onClick={() => setStatus(a, "no_show")}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 px-2"
                  onClick={() => setReplaceFor(a)}
                  disabled={status === "approved"}
                  title="Find replacement"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
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
