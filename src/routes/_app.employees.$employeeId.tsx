import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, FileSignature, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNAD, formatDate, initials } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { canWriteEquipment } from "@/lib/permissions";
import {
  IssueEquipmentDialog,
  CloseIssueDialog,
  ISSUE_STATUS_BADGE,
} from "@/components/equipment-dialogs";
import { PackageCheck, Undo2, ShieldAlert, LogOut } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  APPROVAL_LABELS,
  approvalBadgeClass,
  canVerify,
  canConfirm,
  exitRequiresVerification,
  EXIT_TYPE_LABELS,
  VERIFIER_ROLES_EXIT,
  CONFIRMER_ROLES_EXIT,
  type ApprovalStatus,
} from "@/lib/approvals";
import {
  disciplinaryActionLabel,
  disciplinaryBadgeClass,
  fetchRecorderProfiles,
  recordedByLabel,
} from "@/lib/disciplinary";
import { LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL, dateSpanLabel, leaveStatusClass } from "@/lib/leave";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select(`*, sites:home_site_id ( name )`)
        .eq("id", employeeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: leave } = useQuery({
    queryKey: ["employee-leave", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balances")
        .select("annual_days, sick_days, compassionate_days, off_days")
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: leaveHistory = [] } = useQuery({
    queryKey: ["employee-leave-history", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select(
          "id,leave_type,start_date,end_date,status,charged_units,paid_percent,reason,decision_notes",
        )
        .eq("employee_id", employeeId)
        .order("requested_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateDaysPerWeek = useMutation({
    mutationFn: async (days: number) => {
      const { error } = await supabase
        .from("employees")
        .update({ days_per_week: days })
        .eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Working days updated");
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update working days"),
  });

  const updateGrade = useMutation({
    mutationFn: async (grade: "A+" | "A" | "B" | "C" | "D" | null) => {
      const { error } = await supabase
        .from("employees")
        .update({ literacy_grade: grade })
        .eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Grade updated");
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update grade"),
  });

  const updatePreferredShift = useMutation({
    mutationFn: async (shift: "day" | "night" | "both") => {
      const { error } = await supabase
        .from("employees")
        .update({ preferred_shift: shift })
        .eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferred shift updated");
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update preferred shift"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <p className="text-muted-foreground">Employee not found.</p>
        <Button asChild className="mt-4">
          <Link to="/employees">Back to employees</Link>
        </Button>
      </div>
    );
  }

  const isManagement = data.category === "management";

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link to="/employees">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to employees
          </Link>
        </Button>
        <Button asChild size="sm" variant={data.contract_signed_at ? "outline" : "default"}>
          <Link to="/onboarding/$employeeId" params={{ employeeId }}>
            <FileSignature className="mr-2 h-4 w-4" />
            {data.contract_signed_at ? "View contract" : "Set up contract"}
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-display text-xl font-semibold">
          {initials(`${data.first_names} ${data.surname}`)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {data.surname}, {data.first_names}
            </h1>
            <Badge variant="outline" className="capitalize">
              {data.status}
            </Badge>
            {data.contract_signed_at ? (
              <Badge variant="outline" className="bg-success/15 text-success border-success/30">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Contract signed
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-warning/15 text-warning border-warning/40">
                <AlertCircle className="mr-1 h-3 w-3" /> Contract pending
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1 font-mono">{data.employee_code}</div>
          <div className="text-sm text-muted-foreground capitalize">
            {data.position.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compensation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Hourly rate" value={formatNAD(data.hourly_rate)} mono />
            <Row label="Transport allowance" value={formatNAD(data.transport_allowance)} mono />
            <Row label="Bank" value={data.bank_name ?? "—"} />
            <Row label="Account" value={data.bank_account_number ?? "—"} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact & site</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Phone" value={data.phone ?? "—"} mono />
            <Row label="Email" value={data.email ?? "—"} />
            <Row label="National ID" value={data.national_id ?? "—"} mono />
            <Row label="Home site" value={(data.sites as { name?: string } | null)?.name ?? "—"} />
            <Row label="Start date" value={formatDate(data.start_date)} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agreements & preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Union member" value={data.union_member ? "Yes" : "No"} />
            {/* No longer a per-employee switch: the employment contract commits every guard
                to the agreed Sunday/holiday rate, so this is stated, not chosen. The column
                is kept for the day that policy is unwound. */}
            <Row
              label="Sunday / holiday rate"
              value="1.5× by contract (2× when called in as a replacement)"
            />
            <div className="flex items-center justify-between gap-4 py-1">
              <span className="text-muted-foreground">Preferred shift</span>
              <Select
                value={data.preferred_shift}
                onValueChange={(v) => updatePreferredShift.mutate(v as "day" | "night" | "both")}
                disabled={updatePreferredShift.isPending}
              >
                <SelectTrigger className="h-8 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day only</SelectItem>
                  <SelectItem value="night">Night only</SelectItem>
                  <SelectItem value="both">Day or Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isManagement && (
              <div className="flex items-center justify-between gap-4 py-1">
                <span className="text-muted-foreground">Typical days / week</span>
                <Select
                  value={String(Math.round(Number(data.days_per_week ?? 6)) || 6)}
                  onValueChange={(v) => updateDaysPerWeek.mutate(Number(v))}
                  disabled={updateDaysPerWeek.isPending}
                >
                  <SelectTrigger className="h-8 w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} {d === 1 ? "day" : "days"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-1">
              <span className="text-muted-foreground">Literacy grade</span>
              <Select
                value={data.literacy_grade ?? "none"}
                onValueChange={(v) =>
                  updateGrade.mutate(v === "none" ? null : (v as "A+" | "A" | "B" | "C" | "D"))
                }
                disabled={isManagement || updateGrade.isPending}
              >
                <SelectTrigger className="h-8 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ungraded</SelectItem>
                  <SelectItem value="A+">A+ — Fluent, multilingual</SelectItem>
                  <SelectItem value="A">A — Fluent reading/writing</SelectItem>
                  <SelectItem value="B">B — Okay</SelectItem>
                  <SelectItem value="C">C — Limited</SelectItem>
                  <SelectItem value="D">D — Minimal (vehicle-standby only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        {!isManagement && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row
                label="Annual leave balance"
                value={`${Number(leave?.annual_days ?? 0).toFixed(2)} days`}
                mono
              />
              <Row label="Annual entitlement" value="4 ordinary work weeks / cycle" mono />
              <Row label="Sick days" value={`${Number(leave?.sick_days ?? 0).toFixed(2)}`} mono />
              <Row
                label="Compassionate"
                value={`${Number(leave?.compassionate_days ?? 0).toFixed(2)}`}
                mono
              />
              <p className="text-xs text-muted-foreground pt-1">
                Annual leave accrues proportionally toward four ordinary work weeks per 12-month
                cycle and is credited when each payroll period is finalized.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {!isManagement && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Leave request history</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link to="/leave">Open leave management</Link>
            </Button>
          </CardHeader>
          <CardContent className="text-sm">
            {leaveHistory.length === 0 ? (
              <p className="text-muted-foreground py-2">
                No leave requests recorded for this employee.
              </p>
            ) : (
              <div className="divide-y">
                {leaveHistory.map((request) => (
                  <div key={request.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <div className="font-medium">{LEAVE_TYPE_LABEL[request.leave_type]}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {dateSpanLabel(request.start_date, request.end_date)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{request.reason}</div>
                      {request.decision_notes && (
                        <div className="text-xs text-muted-foreground">
                          Decision: {request.decision_notes}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant="outline" className={leaveStatusClass(request.status)}>
                        {LEAVE_STATUS_LABEL[request.status]}
                      </Badge>
                      {request.status === "approved" && (
                        <div className="font-mono text-xs text-muted-foreground mt-1">
                          {Number(request.charged_units).toFixed(2)}d ·{" "}
                          {Number(request.paid_percent)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <EmploymentExitCard employeeId={employeeId} employeeStatus={data.status} />
      <DisciplinaryHistoryCard employeeId={employeeId} />
      <EquipmentCard employeeId={employeeId} />
    </div>
  );
}

// Tracker #4 (dismissal with a required reason) and #5 (resignation protocol) — one exit
// workflow, because they're the same event with different triggers. Recording is separate
// from confirming: a dismissal must also be verified by a second person before a third can
// confirm it, which is what actually ends the employment (Labour Act fair-procedure).
const EXIT_RECORDERS = ["admin", "operations", "supervisor", "payroll"];

function EmploymentExitCard({
  employeeId,
  employeeStatus,
}: {
  employeeId: string;
  employeeStatus: string;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const role = profile?.role;
  const canRecord = !!role && EXIT_RECORDERS.includes(role);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    exit_type: "dismissal",
    reason: "",
    notice_date: "",
    last_working_day: "",
  });

  const { data: exits } = useQuery({
    queryKey: ["employee-exits", employeeId],
    enabled: canRecord,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_exits")
        .select("*")
        .eq("employee_id", employeeId)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      const people = await fetchRecorderProfiles(
        (data ?? []).flatMap((e: any) => [e.recorded_by, e.verified_by, e.confirmed_by]),
      );
      return (data ?? []).map((e: any) => ({ ...e, people }));
    },
  });

  const recordMut = useMutation({
    mutationFn: async () => {
      if (!form.reason.trim()) throw new Error("A reason is required");
      const { error } = await supabase.from("employment_exits").insert({
        tenant_id: profile!.tenant_id,
        employee_id: employeeId,
        exit_type: form.exit_type as
          | "dismissal"
          | "resignation"
          | "end_of_contract"
          | "abscondment",
        reason: form.reason.trim(),
        notice_date: form.notice_date || null,
        last_working_day: form.last_working_day || null,
        recorded_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Exit recorded — it needs sign-off before it takes effect");
      setOpen(false);
      setForm({ exit_type: "dismissal", reason: "", notice_date: "", last_working_day: "" });
      void queryClient.invalidateQueries({ queryKey: ["employee-exits", employeeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not record the exit"),
  });

  const stepMut = useMutation({
    mutationFn: async ({ id, step }: { id: string; step: "verify" | "confirm" }) => {
      const { error } =
        step === "verify"
          ? await supabase.rpc("verify_employment_exit", { p_exit: id })
          : await supabase.rpc("confirm_employment_exit", { p_exit: id });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.step === "verify" ? "Exit verified" : "Exit confirmed — the employee is now terminated",
      );
      void queryClient.invalidateQueries({ queryKey: ["employee-exits", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Step failed"),
  });

  if (!canRecord) return null;

  const openExit = (exits ?? []).find(
    (e: any) => e.status === "recorded" || e.status === "verified",
  );
  const nameOf = (people: Map<string, { full_name: string }>, id: string | null) =>
    id ? (people.get(id)?.full_name ?? "unknown user") : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <LogOut className="h-4 w-4" />
          Employment exit
          {employeeStatus === "terminated" && (
            <Badge
              variant="outline"
              className="bg-destructive/15 text-destructive border-destructive/40"
            >
              Terminated
            </Badge>
          )}
        </CardTitle>
        {employeeStatus !== "terminated" && !openExit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Record exit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Record an employment exit</DialogTitle>
                <DialogDescription>
                  This does not end employment on its own. For a dismissal, Payroll or Operations
                  records it, a different Operations, Payroll, or Admin user verifies it, then a
                  third Operations or Admin user confirms it. Confirmation is when the guard
                  becomes terminated.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Type</Label>
                  <Select
                    value={form.exit_type}
                    onValueChange={(v) => setForm({ ...form, exit_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EXIT_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Notice date</Label>
                    <Input
                      type="date"
                      value={form.notice_date}
                      onChange={(e) => setForm({ ...form, notice_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Last working day</Label>
                    <Input
                      type="date"
                      value={form.last_working_day}
                      onChange={(e) => setForm({ ...form, last_working_day: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>
                    Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    rows={3}
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Why is this employment ending? Reference the disciplinary record or resignation letter."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => recordMut.mutate()} disabled={recordMut.isPending}>
                  {recordMut.isPending ? "Saving…" : "Record exit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {!exits?.length ? (
          <p className="text-muted-foreground py-2">No exit has been recorded for this employee.</p>
        ) : (
          <div className="divide-y">
            {exits.map((e: any) => {
              const requiresVerification = exitRequiresVerification(e.exit_type);
              return (
                <div key={e.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {EXIT_TYPE_LABELS[e.exit_type] ?? e.exit_type}
                      <Badge variant="outline" className={approvalBadgeClass(e.status)}>
                        {APPROVAL_LABELS[e.status as ApprovalStatus]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canVerify(e, profile?.id, role, VERIFIER_ROLES_EXIT) &&
                        requiresVerification && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={stepMut.isPending}
                            onClick={() => stepMut.mutate({ id: e.id, step: "verify" })}
                          >
                            Verify
                          </Button>
                        )}
                      {canConfirm(e, profile?.id, role, CONFIRMER_ROLES_EXIT, {
                        requiresVerification,
                      }) && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={stepMut.isPending}
                          onClick={() => stepMut.mutate({ id: e.id, step: "confirm" })}
                        >
                          Confirm
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Recorded by {nameOf(e.people, e.recorded_by)} {formatDate(e.recorded_at)}
                    {e.verified_by && <> · verified by {nameOf(e.people, e.verified_by)}</>}
                    {e.confirmed_by && <> · confirmed by {nameOf(e.people, e.confirmed_by)}</>}
                    {e.notice_date && <> · notice {formatDate(e.notice_date)}</>}
                    {e.last_working_day && <> · last day {formatDate(e.last_working_day)}</>}
                  </div>
                  <div className="text-xs">{e.reason}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Issue #2 — the full disciplinary record for one guard in one place, newest first, so you
// don't have to scan the tenant-wide Disciplinary page to reconstruct their history.
const DISCIPLINARY_VIEWERS = [
  "admin",
  "operations",
  "supervisor",
  "payroll",
  "security_supervisor",
];

function DisciplinaryHistoryCard({ employeeId }: { employeeId: string }) {
  const { profile } = useAuth();
  const canView = !!profile?.role && DISCIPLINARY_VIEWERS.includes(profile.role);

  const { data: history } = useQuery({
    queryKey: ["employee-disciplinary", employeeId],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disciplinary_actions")
        .select("*, sites:incident_site_id(name)")
        .eq("employee_id", employeeId)
        .order("incident_date", { ascending: false });
      if (error) throw error;
      const recorders = await fetchRecorderProfiles((data ?? []).map((d: any) => d.created_by));
      return (data ?? []).map((d: any) => ({
        ...d,
        recorded_by: d.created_by ? (recorders.get(d.created_by) ?? null) : null,
      }));
    },
  });

  if (!canView) return null;

  const active = (history ?? []).filter(
    (h: any) => h.action_type === "final_warning" || h.action_type === "dismissal",
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          Disciplinary history
          {(history?.length ?? 0) > 0 && (
            <Badge
              variant="outline"
              className={
                active.length > 0
                  ? "bg-destructive/15 text-destructive border-destructive/40"
                  : "bg-warning/15 text-warning border-warning/40"
              }
            >
              {history!.length} record{history!.length === 1 ? "" : "s"}
            </Badge>
          )}
        </CardTitle>
        <Button size="sm" variant="outline" asChild>
          <Link to="/disciplinary" search={{ employee: employeeId }}>
            Log new incident
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="text-sm">
        {!history?.length ? (
          <p className="text-muted-foreground py-2">No disciplinary records for this employee.</p>
        ) : (
          <div className="divide-y">
            {history.map((h: any) => (
              <div key={h.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {h.offence_code}
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatDate(h.incident_date)}
                      {h.sites?.name ? ` · ${h.sites.name}` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Recorded by {recordedByLabel(h.recorded_by)}
                    {Number(h.fine_amount || 0) > 0 && (
                      <> · fine {formatNAD(Number(h.fine_amount))}</>
                    )}
                    {Number(h.suspension_hours || 0) > 0 && (
                      <> · {Number(h.suspension_hours)}h unpaid</>
                    )}
                    {h.action_type === "fine_with_ca" &&
                      !h.collective_agreement_reference?.trim() && (
                        <span className="text-destructive"> · CA ref missing</span>
                      )}
                  </div>
                  {h.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{h.description}</div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 ${disciplinaryBadgeClass(h.action_type)}`}
                >
                  {disciplinaryActionLabel(h.action_type)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentCard({ employeeId }: { employeeId: string }) {
  const { profile } = useAuth();
  const canWrite = canWriteEquipment(profile?.role);

  const { data: history } = useQuery({
    queryKey: ["employee-equipment", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_issues")
        .select("*, equipment_items(name,category,unit_cost)")
        .eq("employee_id", employeeId)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["equipment-items"],
    enabled: canWrite,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_items")
        .select("*")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const outstanding = (history ?? []).filter((h: any) => h.status === "issued");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageCheck className="h-4 w-4" />
          Equipment
          {outstanding.length > 0 && (
            <Badge variant="outline" className="bg-warning/15 text-warning border-warning/40">
              {outstanding.length} outstanding
            </Badge>
          )}
        </CardTitle>
        {canWrite && (
          <IssueEquipmentDialog
            items={items}
            presetEmployeeId={employeeId}
            trigger={
              <Button size="sm" variant="outline">
                Issue equipment
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {!history?.length ? (
          <p className="text-muted-foreground py-2">
            No equipment has been issued to this employee.
          </p>
        ) : (
          <div className="divide-y">
            {history.map((h: any) => {
              const badge = ISSUE_STATUS_BADGE[h.status] ?? ISSUE_STATUS_BADGE.issued;
              return (
                <div key={h.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {h.equipment_items?.name}
                      {h.quantity > 1 && (
                        <span className="text-muted-foreground"> × {h.quantity}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Issued {formatDate(h.issued_at)}
                      {h.acknowledged ? " · receipt signed" : " · receipt not signed"}
                      {h.returned_at && (
                        <>
                          {" "}
                          · {h.status === "returned" ? "returned" : h.status}{" "}
                          {formatDate(h.returned_at)}
                          {h.condition_on_return ? ` (${h.condition_on_return})` : ""}
                        </>
                      )}
                      {h.charge_amount != null && Number(h.charge_amount) > 0 && (
                        <> · charge {formatNAD(Number(h.charge_amount))}</>
                      )}
                    </div>
                    {h.notes && (
                      <div className="text-xs text-muted-foreground mt-0.5">{h.notes}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={badge.className}>
                      {badge.label}
                    </Badge>
                    {canWrite && h.status === "issued" && (
                      <CloseIssueDialog
                        issue={h}
                        trigger={
                          <Button size="sm" variant="ghost">
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
