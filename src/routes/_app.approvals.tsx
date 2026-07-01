import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck, CheckCircle2, XCircle, Loader2, ShieldCheck, ChevronLeft, ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmtIso(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const Route = createFileRoute("/_app/approvals")({
  component: ApprovalsPage,
  head: () => ({ meta: [{ title: "Attendance approvals — Demo Payroll System" }] }),
});

type SubmittedLog = {
  id: string;
  employee_id: string;
  site_id: string;
  date: string;
  hours_worked: number;
  night_hours: number;
  status: string;
  notes: string | null;
  employees: { surname: string; first_names: string; employee_code: string } | null;
  sites: { name: string } | null;
  shift_types: { code: string; label: string } | null;
};

function ApprovalsPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  if (role && role !== "admin" && role !== "operations" && role !== "payroll") {
    return <AccessDenied message="Approvals are restricted to payroll and operations staff." />;
  }
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [date, setDate] = useState(() => fmtIso(new Date()));
  const dateObj = useMemo(() => new Date(date), [date]);

  function shiftDay(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(fmtIso(d));
  }

  const { data: logs, isLoading } = useQuery<SubmittedLog[]>({
    queryKey: ["submitted-logs", profile?.tenant_id, date],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_logs")
        .select(
          "id, employee_id, site_id, date, hours_worked, night_hours, status, notes, employees(surname, first_names, employee_code), sites(name), shift_types(code, label)"
        )
        .eq("status", "submitted")
        .eq("date", date)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SubmittedLog[];
    },
  });

  const approve = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("shift_logs")
        .update({ status: "approved" })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      toast.success(`Approved ${ids.length} record${ids.length === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["submitted-logs"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Approve failed"),
    onSettled: () => setBusyId(null),
  });

  const markAbsent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("shift_logs")
        .update({ status: "no_show", hours_worked: 0, night_hours: 0 })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked absent");
      void qc.invalidateQueries({ queryKey: ["submitted-logs"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
    onSettled: () => setBusyId(null),
  });

  // Group by site.
  const bySite = useMemo(() => {
    const m = new Map<string, SubmittedLog[]>();
    (logs ?? []).forEach((l) => {
      const arr = m.get(l.site_id) ?? [];
      arr.push(l);
      m.set(l.site_id, arr);
    });
    return Array.from(m.entries());
  }, [logs]);

  const total = logs?.length ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" /> Attendance approvals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {dateObj.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            {" · "}Attendance submitted by supervisors. Verify it to count toward payroll.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftDay(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-[160px] font-mono" />
          <Button variant="outline" size="sm" onClick={() => shiftDay(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setDate(fmtIso(new Date()))}>Today</Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => { setBusyId("all"); approve.mutate((logs ?? []).map((l) => l.id)); }}
          disabled={total === 0 || approve.isPending}
        >
          {approve.isPending && busyId === "all"
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <ShieldCheck className="h-4 w-4 mr-2" />}
          Approve all for this date ({total})
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" /></div>
      ) : total === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          Nothing awaiting approval for this date.
        </CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {bySite.map(([siteId, rows]) => (
                <SiteRows key={siteId} rows={rows} busyId={busyId}
                  onApprove={(id) => { setBusyId(id); approve.mutate([id]); }}
                  onAbsent={(id) => { setBusyId(id); markAbsent.mutate(id); }}
                  pending={approve.isPending || markAbsent.isPending}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function SiteRows({
  rows, busyId, onApprove, onAbsent, pending,
}: {
  rows: SubmittedLog[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onAbsent: (id: string) => void;
  pending: boolean;
}) {
  const siteName = rows[0]?.sites?.name ?? "—";
  return (
    <>
      <tr className="bg-primary/5">
        <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {siteName} <span className="opacity-60 font-normal">· {rows.length} guard{rows.length === 1 ? "" : "s"}</span>
        </td>
      </tr>
      {rows.map((l) => (
        <tr key={l.id} className="border-t hover:bg-muted/20">
          <td className="px-4 py-2">
            <div className="font-medium leading-tight">{l.employees?.surname}, {l.employees?.first_names}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{l.employees?.employee_code}</div>
          </td>
          <td className="px-4 py-2">
            <div className="font-mono text-xs font-medium">{l.shift_types?.code}</div>
            <div className="text-[11px] text-muted-foreground">
              {Number(l.hours_worked).toFixed(0)}h{l.night_hours > 0 ? ` · ${Number(l.night_hours).toFixed(0)}h night` : ""}
            </div>
          </td>
          <td className="px-4 py-2">
            <div className="flex items-center justify-end gap-2">
              <Badge variant="outline" className={cn("font-medium border", "bg-primary/15 text-primary border-primary/30")}>
                Awaiting approval
              </Badge>
              <Button size="sm" className="h-7 bg-success hover:bg-success/90 text-success-foreground"
                onClick={() => onApprove(l.id)} disabled={pending}>
                {pending && busyId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7"
                onClick={() => onAbsent(l.id)} disabled={pending} title="Reject — mark absent">
                <XCircle className="h-3.5 w-3.5 mr-1" /> Absent
              </Button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
