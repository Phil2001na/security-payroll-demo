import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarOff,
  Check,
  CircleDollarSign,
  Clock3,
  Download,
  Loader2,
  Plus,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  balanceFor,
  coverageStatusClass,
  dateSpanLabel,
  leaveStatusClass,
  type LeavePolicy,
  type LeaveType,
} from "@/lib/leave";
import {
  capacityWarnings,
  describeWarning,
  requiresReason,
  type CapacityRow,
  type CapacityWarning,
} from "@/lib/leave-capacity";
import {
  DIRECTED_LEAVE_RESPONSES,
  RESPONSE_HINT,
  RESPONSE_LABEL,
  directedLeaveBlockedReason,
  directedLeaveCsvRows,
  directedLeaveWarnings,
  responseBadgeClass,
  type DirectedLeaveDraft,
  type DirectedLeaveResponse,
  type DirectedLeaveRow,
} from "@/lib/directed-leave";
import {
  deadlineRisk,
  describeDeadlineRisk,
  hasCapacityDeadlineConflict,
  rejectionNeedsDeadlineWarning,
  type DeadlineRisk,
} from "@/lib/leave-deadline";

export const Route = createFileRoute("/_app/leave")({ component: LeavePage });

type Employee = {
  id: string;
  first_names: string;
  surname: string;
  employee_code: string;
  status: string;
  home_site_id: string | null;
};
type Balance = {
  employee_id: string;
  annual_days: number;
  sick_days: number;
  compassionate_days: number;
};
type RequestRow = {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  evidence_url: string | null;
  status: "submitted" | "approved" | "rejected" | "cancelled";
  charged_units: number;
  paid_percent: number;
  requested_by: string;
  decision_notes: string | null;
  employees: Employee | null;
};
type CoverageRow = {
  id: string;
  coverage_date: string;
  planned_hours: number;
  status: "open" | "assigned" | "waived" | "cancelled";
  replacement_employee_id: string | null;
  leave_employee_id: string;
  site_id: string;
  waived_reason: string | null;
  sites: { name: string } | null;
  shift_types: { label: string } | null;
  leave_employee: Employee | null;
  replacement_employee: Employee | null;
};
type LedgerRow = {
  id: string;
  effective_date: string;
  leave_type: LeaveType;
  entry_type: string;
  units: number;
  reference: string | null;
  created_at: string;
  employees: Employee | null;
};
type CycleRow = {
  id: string;
  cycle_start: string;
  cycle_end: string;
  leave_type: LeaveType;
  entitlement_units: number;
  latest_leave_date: string | null;
  employees: Employee | null;
};

function nameOf(e: Employee | null | undefined) {
  return e ? `${e.surname}, ${e.first_names}` : "Unknown employee";
}

function isoDateAdd(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function LeavePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role;
  const allowed = ["admin", "operations", "supervisor", "payroll"].includes(
    role ?? "",
  );
  const canApprove = ["admin", "operations", "payroll"].includes(role ?? "");
  const canCover = ["admin", "operations", "supervisor", "payroll"].includes(role ?? "");
  const canViewLedger = ["admin", "operations", "supervisor", "payroll"].includes(role ?? "");
  const isAdmin = role === "admin";
  const [requestOpen, setRequestOpen] = useState(false);
  const [decision, setDecision] = useState<{
    id: string;
    action: "approve" | "reject" | "cancel";
    leaveType: LeaveType;
    employeeId: string;
    requestEnd: string;
  } | null>(null);
  const [cover, setCover] = useState<CoverageRow | null>(null);
  const [waive, setWaive] = useState<CoverageRow | null>(null);
  const [adjust, setAdjust] = useState<Employee | null>(null);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["leave-requests"] }),
      qc.invalidateQueries({ queryKey: ["leave-coverage"] }),
      qc.invalidateQueries({ queryKey: ["leave-balances"] }),
      qc.invalidateQueries({ queryKey: ["leave-ledger"] }),
      qc.invalidateQueries({ queryKey: ["leave-cycles"] }),
      qc.invalidateQueries({ queryKey: ["assignments-all"] }),
    ]);
  };

  const { data: employees = [] } = useQuery({
    queryKey: ["leave-employees", profile?.tenant_id],
    enabled: allowed && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,first_names,surname,employee_code,status,home_site_id")
        .eq("status", "active")
        .order("surname");
      if (error) throw error;
      return data as Employee[];
    },
  });
  const { data: balances = [] } = useQuery({
    queryKey: ["leave-balances", profile?.tenant_id],
    enabled: allowed && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balances")
        .select("employee_id,annual_days,sick_days,compassionate_days");
      if (error) throw error;
      return data as Balance[];
    },
  });
  const { data: policies = [] } = useQuery({
    queryKey: ["leave-policies", profile?.tenant_id],
    enabled: allowed && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_policies").select("*").order("leave_type");
      if (error) throw error;
      return data as LeavePolicy[];
    },
  });
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["leave-requests", profile?.tenant_id],
    enabled: allowed && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*,employees:employee_id(id,first_names,surname,employee_code,status)")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as RequestRow[];
    },
  });
  const { data: coverage = [] } = useQuery({
    queryKey: ["leave-coverage", profile?.tenant_id],
    enabled: allowed && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_coverage")
        .select(
          "*,sites:site_id(name),shift_types:shift_type_id(label),leave_employee:leave_employee_id(id,first_names,surname,employee_code,status),replacement_employee:replacement_employee_id(id,first_names,surname,employee_code,status)",
        )
        .order("coverage_date");
      if (error) throw error;
      return data as unknown as CoverageRow[];
    },
  });
  const { data: ledger = [] } = useQuery({
    queryKey: ["leave-ledger", profile?.tenant_id],
    enabled: canViewLedger && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_ledger")
        .select(
          "id,effective_date,leave_type,entry_type,units,reference,created_at,employees:employee_id(id,first_names,surname,employee_code,status)",
        )
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as unknown as LedgerRow[];
    },
  });
  const { data: cycles = [] } = useQuery({
    queryKey: ["leave-cycles", profile?.tenant_id],
    enabled: canViewLedger && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_cycles")
        .select(
          "id,cycle_start,cycle_end,leave_type,entitlement_units,latest_leave_date,employees:employee_id(id,first_names,surname,employee_code,status)",
        )
        .gte("cycle_end", new Date().toISOString().slice(0, 10))
        .order("cycle_end");
      if (error) throw error;
      return data as unknown as CycleRow[];
    },
  });
  const { data: sites = [] } = useQuery({
    queryKey: ["leave-sites", profile?.tenant_id],
    enabled: canViewLedger && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id,name").eq("active", true);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  // UAT-12: proactive leave planner — who's due/overdue for annual leave, using UAT-11's
  // statutory deadline (leave_cycles.latest_leave_date), their current balance, and a simple
  // coverage-risk signal (how many other active guards share their home site). Suggests
  // nothing and books nothing — manager decision stays entirely human.
  const LEAVE_PLANNER_WINDOW_DAYS = 90;
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);
  const homeSiteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.home_site_id) continue;
      counts.set(e.home_site_id, (counts.get(e.home_site_id) ?? 0) + 1);
    }
    return counts;
  }, [employees]);
  const plannerRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const windowEnd = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + LEAVE_PLANNER_WINDOW_DAYS);
      return d.toISOString().slice(0, 10);
    })();
    return cycles
      .filter((c) => c.leave_type === "annual" && c.latest_leave_date)
      .filter((c) => c.latest_leave_date! <= windowEnd)
      .map((c) => {
        const emp = employeeById.get(c.employees?.id ?? "");
        const balance = balanceFor(
          balances.find((b) => b.employee_id === c.employees?.id),
          "annual",
        );
        const siteName = emp?.home_site_id ? (siteById.get(emp.home_site_id) ?? null) : null;
        const coworkers = emp?.home_site_id ? (homeSiteCounts.get(emp.home_site_id) ?? 1) - 1 : null;
        const coverageRisk: "high" | "medium" | "low" | null =
          coworkers === null ? null : coworkers <= 1 ? "high" : coworkers <= 3 ? "medium" : "low";
        return {
          cycleId: c.id,
          employee: c.employees,
          cycleEnd: c.cycle_end,
          latestLeaveDate: c.latest_leave_date!,
          overdue: c.latest_leave_date! < today,
          balance,
          siteName,
          coverageRisk,
        };
      })
      .sort((a, b) => a.latestLeaveDate.localeCompare(b.latestLeaveDate));
  }, [cycles, employeeById, balances, siteById, homeSiteCounts]);

  const pending = requests.filter((r) => r.status === "submitted");
  const openCover = coverage.filter((c) => c.status === "open");
  const onLeaveNow = requests.filter(
    (r) =>
      r.status === "approved" &&
      r.start_date <= new Date().toISOString().slice(0, 10) &&
      r.end_date >= new Date().toISOString().slice(0, 10),
  );

  if (!allowed) return <AccessDenied message="Your role does not have access to leave records." />;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <CalendarOff className="h-7 w-7" /> Leave management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Requests, balances, roster coverage and payroll-ready leave in one workflow.
          </p>
        </div>
        <Button onClick={() => setRequestOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New leave request
        </Button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Summary title="Awaiting approval" value={pending.length} icon={Clock3} tone="warning" />
        <Summary
          title="Open cover shifts"
          value={openCover.length}
          icon={UserRoundCheck}
          tone="danger"
        />
        <Summary
          title="On leave today"
          value={onLeaveNow.length}
          icon={ShieldCheck}
          tone="success"
        />
      </div>
      <Tabs defaultValue="requests">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          {canApprove && <TabsTrigger value="directed">Directed leave</TabsTrigger>}
          {canViewLedger && <TabsTrigger value="ledger">Ledger & report</TabsTrigger>}
          {isAdmin && <TabsTrigger value="policies">Policies</TabsTrigger>}
        </TabsList>
        <TabsContent value="requests">
          <RequestsTable
            rows={requests}
            loading={isLoading}
            canApprove={canApprove}
            userId={profile?.id ?? ""}
            onDecision={setDecision}
          />
        </TabsContent>
        <TabsContent value="coverage">
          <CoverageTable
            rows={coverage}
            canCover={canCover}
            canWaive={canApprove}
            onAssign={setCover}
            onWaive={setWaive}
            onChanged={invalidate}
          />
        </TabsContent>
        <TabsContent value="balances">
          <BalancesTable
            employees={employees}
            balances={balances}
            canAdjust={canApprove}
            onAdjust={setAdjust}
          />
        </TabsContent>
        {canApprove && (
          <TabsContent value="directed">
            <DirectedLeaveTab employees={employees} />
          </TabsContent>
        )}
        {canViewLedger && (
          <TabsContent value="ledger">
            <div className="space-y-4">
              <LeavePlannerTable rows={plannerRows} />
              <CyclesTable rows={cycles} />
              <LedgerTable rows={ledger} />
            </div>
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="policies">
            <Policies
              policies={policies}
              onChanged={async () => {
                await qc.invalidateQueries({ queryKey: ["leave-policies"] });
              }}
            />
          </TabsContent>
        )}
      </Tabs>
      <RequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        employees={employees}
        policies={policies}
        balances={balances}
        onSaved={invalidate}
      />
      <DecisionDialog
        value={decision}
        sites={sites}
        cycles={cycles}
        onOpenChange={(v) => !v && setDecision(null)}
        onSaved={async () => {
          setDecision(null);
          await invalidate();
        }}
      />
      <CoverDialog
        coverage={cover}
        employees={employees}
        onOpenChange={(v) => !v && setCover(null)}
        onSaved={async () => {
          setCover(null);
          await invalidate();
        }}
      />
      <WaiveDialog
        coverage={waive}
        onOpenChange={(v) => !v && setWaive(null)}
        onSaved={async () => {
          setWaive(null);
          await invalidate();
        }}
      />
      <AdjustmentDialog
        employee={adjust}
        onOpenChange={(v) => !v && setAdjust(null)}
        onSaved={async () => {
          setAdjust(null);
          await invalidate();
        }}
      />
    </div>
  );
}

function Summary({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  icon: typeof Clock3;
  tone: "warning" | "danger" | "success";
}) {
  const cls =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-success";
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
        <Icon className={`h-6 w-6 ${cls}`} />
      </CardContent>
    </Card>
  );
}

function RequestsTable({
  rows,
  loading,
  canApprove,
  userId,
  onDecision,
}: {
  rows: RequestRow[];
  loading: boolean;
  canApprove: boolean;
  userId: string;
  onDecision: (v: {
    id: string;
    action: "approve" | "reject" | "cancel";
    leaveType: LeaveType;
    employeeId: string;
    requestEnd: string;
  }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave requests</CardTitle>
        <CardDescription>
          Approval charges only dates on which the guard was actually rostered to work.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guard</TableHead>
              <TableHead>Type / dates</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Charged</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No leave requests yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{nameOf(r.employees)}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.employees?.employee_code}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{LEAVE_TYPE_LABEL[r.leave_type]}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {dateSpanLabel(r.start_date, r.end_date)}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="truncate" title={r.reason}>
                      {r.reason}
                    </div>
                    {r.evidence_url && <EvidenceLink value={r.evidence_url} />}
                  </TableCell>
                  <TableCell className="font-mono">
                    {r.status === "approved"
                      ? `${Number(r.charged_units).toFixed(2)}d · ${Number(r.paid_percent)}%`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={leaveStatusClass(r.status)}>
                      {LEAVE_STATUS_LABEL[r.status]}
                    </Badge>
                    {r.decision_notes && (
                      <div className="text-xs text-muted-foreground mt-1">{r.decision_notes}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      {r.status === "submitted" && canApprove && r.requested_by !== userId && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onDecision({
                                id: r.id,
                                action: "approve",
                                leaveType: r.leave_type,
                                employeeId: r.employee_id,
                                requestEnd: r.end_date,
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onDecision({
                                id: r.id,
                                action: "reject",
                                leaveType: r.leave_type,
                                employeeId: r.employee_id,
                                requestEnd: r.end_date,
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {r.status === "approved" && canApprove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onDecision({
                              id: r.id,
                              action: "cancel",
                              leaveType: r.leave_type,
                              employeeId: r.employee_id,
                              requestEnd: r.end_date,
                            })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CoverageTable({
  rows,
  canCover,
  canWaive,
  onAssign,
  onWaive,
  onChanged,
}: {
  rows: CoverageRow[];
  canCover: boolean;
  canWaive: boolean;
  onAssign: (r: CoverageRow) => void;
  onWaive: (r: CoverageRow) => void;
  onChanged: () => Promise<void>;
}) {
  const unassign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("unassign_leave_cover", { p_coverage: id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Cover assignment removed");
      await onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relief coverage</CardTitle>
        <CardDescription>
          Every working shift vacated by approved leave appears here until assigned or explicitly
          waived.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / site</TableHead>
              <TableHead>Guard on leave</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Replacement / waiver</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No leave coverage requirements.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{c.coverage_date}</div>
                    <div>{c.sites?.name ?? "Unknown site"}</div>
                  </TableCell>
                  <TableCell>{nameOf(c.leave_employee)}</TableCell>
                  <TableCell>
                    {c.shift_types?.label ?? "Shift"} · {Number(c.planned_hours)}h
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={coverageStatusClass(c.status)}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.status === "waived"
                      ? c.waived_reason
                      : nameOf(c.replacement_employee) === "Unknown employee"
                        ? "—"
                        : nameOf(c.replacement_employee)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canCover && c.status === "open" && (
                        <Button size="sm" onClick={() => onAssign(c)}>
                          Assign cover
                        </Button>
                      )}
                      {canWaive && c.status === "open" && (
                        <Button size="sm" variant="outline" onClick={() => onWaive(c)}>
                          Waive
                        </Button>
                      )}
                      {canCover && c.status === "assigned" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unassign.isPending}
                          onClick={() => unassign.mutate(c.id)}
                        >
                          Unassign
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BalancesTable({
  employees,
  balances,
  canAdjust,
  onAdjust,
}: {
  employees: Employee[];
  balances: Balance[];
  canAdjust: boolean;
  onAdjust: (e: Employee) => void;
}) {
  const map = new Map(balances.map((b) => [b.employee_id, b]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current balances</CardTitle>
        <CardDescription>
          Annual leave accrues toward four ordinary work weeks per cycle. Every entitlement, usage,
          expiry and correction is preserved in the ledger.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guard</TableHead>
              <TableHead className="text-right">Annual</TableHead>
              <TableHead className="text-right">Sick</TableHead>
              <TableHead className="text-right">Compassionate</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => {
              const b = map.get(e.id);
              return (
                <TableRow key={e.id}>
                  <TableCell>{nameOf(e)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(b?.annual_days ?? 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(b?.sick_days ?? 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(b?.compassionate_days ?? 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canAdjust && (
                      <Button variant="ghost" size="sm" onClick={() => onAdjust(e)}>
                        Adjust
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type PlannerRow = {
  cycleId: string;
  employee: Employee | null;
  cycleEnd: string;
  latestLeaveDate: string;
  overdue: boolean;
  balance: number | null;
  siteName: string | null;
  coverageRisk: "high" | "medium" | "low" | null;
};

const COVERAGE_RISK_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "High — few/no cover at site",
  medium: "Medium",
  low: "Low",
};
const COVERAGE_RISK_CLASS: Record<"high" | "medium" | "low", string> = {
  high: "bg-destructive/15 text-destructive border-destructive/30",
  medium: "bg-warning/15 text-warning border-warning/40",
  low: "bg-success/15 text-success border-success/30",
};

function LeavePlannerTable({ rows }: { rows: PlannerRow[] }) {
  const overdueCount = rows.filter((r) => r.overdue).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave planner — due &amp; overdue for annual leave</CardTitle>
        <CardDescription>
          Employees whose statutory annual-leave deadline (Labour Act s.23) is within 90 days
          or already passed. Suggests nothing automatically — scheduling the leave remains a
          manager decision.
          {overdueCount > 0 && (
            <span className="text-destructive font-medium">
              {" "}
              {overdueCount} already overdue.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guard</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Cycle end</TableHead>
              <TableHead>Must be taken by</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Coverage risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No one is due or overdue for annual leave in the next 90 days.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.cycleId}>
                  <TableCell>{nameOf(row.employee)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.siteName ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.cycleEnd}</TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-xs font-semibold",
                      row.overdue ? "text-destructive" : "text-amber-600",
                    )}
                  >
                    {row.latestLeaveDate}
                    {row.overdue ? " · overdue" : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.balance !== null ? `${row.balance.toFixed(2)}d` : "—"}
                  </TableCell>
                  <TableCell>
                    {row.coverageRisk ? (
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", COVERAGE_RISK_CLASS[row.coverageRisk])}
                      >
                        {COVERAGE_RISK_LABEL[row.coverageRisk]}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CyclesTable({ rows }: { rows: CycleRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active statutory cycles</CardTitle>
        <CardDescription>
          Annual, sick and compassionate cycle windows and their minimum entitlement basis.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guard</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Cycle</TableHead>
              <TableHead>Leave must be taken by</TableHead>
              <TableHead className="text-right">Entitlement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No active cycle records yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const today = new Date().toISOString().slice(0, 10);
                const overdue = !!row.latest_leave_date && row.latest_leave_date < today;
                const dueSoon =
                  !!row.latest_leave_date &&
                  !overdue &&
                  row.latest_leave_date <= isoDateAdd(today, 60);
                return (
                  <TableRow key={row.id}>
                    <TableCell>{nameOf(row.employees)}</TableCell>
                    <TableCell>{LEAVE_TYPE_LABEL[row.leave_type]}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.cycle_start} — {row.cycle_end}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs",
                        overdue && "text-destructive font-semibold",
                        dueSoon && "text-amber-600 font-semibold",
                      )}
                    >
                      {row.latest_leave_date
                        ? `${row.latest_leave_date}${overdue ? " · overdue" : dueSoon ? " · due soon" : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(row.entitlement_units).toFixed(2)}d
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// UAT-13 - the record that annual leave was offered or instructed, and what the employee said.
//
// Decision section 7: typed acknowledgement plus attachments, no signature-capture UI.
// Append-only, enforced by a trigger in the database - there is deliberately no edit or delete
// here, because the value of this record is that it cannot be tidied up after a dispute begins.
function DirectedLeaveTab({ employees }: { employees: Employee[] }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["directed-leave", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("directed_leave_records")
        .select(
          "id,offered_on,leave_start,leave_end,reason,response,typed_acknowledgement,response_note,witness_name,attachments,recorded_at,employees(surname,first_names,employee_code)",
        )
        .order("offered_on", { ascending: false });
      if (error) throw error;
      return data as unknown as DirectedLeaveRow[];
    },
  });

  const exportRows = () =>
    downloadCsv(
      `directed-leave-${new Date().toISOString().slice(0, 10)}.csv`,
      directedLeaveCsvRows(rows),
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Directed leave</CardTitle>
            <CardDescription>
              Evidence that leave was offered or instructed, and what the employee said. The Labour
              Act puts the duty to <em>give</em> annual leave on the employer, so when a guard
              reaches their deadline without taking it, this is the record that shows it was
              offered. Entries cannot be edited or deleted once saved.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={exportRows} disabled={!rows.length}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Record
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guard</TableHead>
                <TableHead>Offered</TableHead>
                <TableHead>Leave dates</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Witness</TableHead>
                <TableHead className="text-right">Files</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Nothing recorded yet. Record an offer when you put leave dates to a guard.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.employees
                      ? `${r.employees.surname}, ${r.employees.first_names}`
                      : "Unknown employee"}
                  </TableCell>
                  <TableCell>{r.offered_on}</TableCell>
                  <TableCell>{dateSpanLabel(r.leave_start, r.leave_end)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(responseBadgeClass(r.response))}>
                      {RESPONSE_LABEL[r.response] ?? r.response}
                    </Badge>
                    {r.typed_acknowledgement && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Typed: {r.typed_acknowledgement}
                      </div>
                    )}
                    {r.response_note && (
                      <div className="text-xs text-muted-foreground mt-1">{r.response_note}</div>
                    )}
                  </TableCell>
                  <TableCell>{r.witness_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.attachments?.length ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DirectedLeaveDialog
        open={open}
        onOpenChange={setOpen}
        employees={employees}
        onSaved={async () => {
          setOpen(false);
          await qc.invalidateQueries({ queryKey: ["directed-leave"] });
        }}
      />
    </div>
  );
}

function DirectedLeaveDialog({
  open,
  onOpenChange,
  employees,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: Employee[];
  onSaved: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const empty: DirectedLeaveDraft = {
    employeeId: "",
    leaveStart: "",
    leaveEnd: "",
    reason: "",
    response: "",
    typedAcknowledgement: "",
    responseNote: "",
    witnessName: "",
  };
  const [draft, setDraft] = useState<DirectedLeaveDraft>(empty);
  const [files, setFiles] = useState<File[]>([]);
  const set = (patch: Partial<DirectedLeaveDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const blocked = directedLeaveBlockedReason(draft);
  const warnings = directedLeaveWarnings(draft, files.length);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("No profile");
      if (blocked) throw new Error(blocked);

      // Upload first. If the record then fails, remove them again rather than leaving
      // orphaned files nothing points at.
      const uploaded: string[] = [];
      try {
        for (const file of files) {
          const safeName = file.name.replace(/[^\w.-]+/g, "_");
          const path = `${profile.tenant_id}/${draft.employeeId}/${crypto.randomUUID()}-${safeName}`;
          const { error } = await supabase.storage
            .from("leave-evidence")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (error) throw error;
          uploaded.push(path);
        }
        const { error } = await supabase.rpc("record_directed_leave", {
          p_employee: draft.employeeId,
          p_leave_start: draft.leaveStart,
          p_leave_end: draft.leaveEnd,
          p_reason: draft.reason.trim(),
          p_response: draft.response as DirectedLeaveResponse,
          p_typed_acknowledgement: draft.typedAcknowledgement.trim() || undefined,
          p_response_note: draft.responseNote.trim() || undefined,
          p_witness_name: draft.witnessName.trim() || undefined,
          p_attachments: uploaded,
        });
        if (error) throw error;
      } catch (err) {
        if (uploaded.length) await supabase.storage.from("leave-evidence").remove(uploaded);
        throw err;
      }
    },
    onSuccess: async () => {
      toast.success("Directed leave recorded");
      setDraft(empty);
      setFiles([]);
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record directed leave</DialogTitle>
          <DialogDescription>
            What was offered, and what the employee said. Saved permanently &mdash; it cannot be
            edited or deleted afterwards, which is what makes it evidence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Employee">
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={draft.employeeId}
              onChange={(e) => set({ employeeId: e.target.value })}
            >
              <option value="">Select an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.surname}, {e.first_names} ({e.employee_code})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Leave offered from">
              <Input
                type="date"
                value={draft.leaveStart}
                onChange={(e) => set({ leaveStart: e.target.value })}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={draft.leaveEnd}
                onChange={(e) => set({ leaveEnd: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Why the leave was offered or instructed">
            <Textarea value={draft.reason} onChange={(e) => set({ reason: e.target.value })} />
          </Field>
          <Field label="What the employee said">
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={draft.response}
              onChange={(e) => set({ response: e.target.value as DirectedLeaveResponse | "" })}
            >
              <option value="">Select a response</option>
              {DIRECTED_LEAVE_RESPONSES.map((r) => (
                <option key={r} value={r}>
                  {RESPONSE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          {draft.response && (
            <p className="text-xs text-muted-foreground">{RESPONSE_HINT[draft.response]}</p>
          )}
          {draft.response === "acknowledged" && (
            <Field
              label="Employee's name, typed"
              hint="Typed, not signed. A scanned signed form can be attached below."
            >
              <Input
                value={draft.typedAcknowledgement}
                onChange={(e) => set({ typedAcknowledgement: e.target.value })}
              />
            </Field>
          )}
          <Field label="Note (optional)">
            <Textarea
              value={draft.responseNote}
              onChange={(e) => set({ responseNote: e.target.value })}
            />
          </Field>
          <Field label="Witness (optional)">
            <Input
              value={draft.witnessName}
              onChange={(e) => set({ witnessName: e.target.value })}
            />
          </Field>
          <Field label="Attachments (optional)" hint="A scan or photo of a signed paper form.">
            <Input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </Field>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning-foreground">
              {w}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!!blocked || save.isPending}>
            Record
          </Button>
        </DialogFooter>
        {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
      </DialogContent>
    </Dialog>
  );
}

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const exportRows = () =>
    downloadCsv(
      `leave-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((r) => ({
        date: r.effective_date,
        employee_code: r.employees?.employee_code ?? "",
        employee: nameOf(r.employees),
        leave_type: LEAVE_TYPE_LABEL[r.leave_type],
        entry_type: r.entry_type,
        units: Number(r.units),
        reference: r.reference ?? "",
        recorded_at: r.created_at,
      })),
    );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Immutable leave ledger</CardTitle>
          <CardDescription>
            Accruals, usage, reversals and manual corrections for audit and management reporting.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={exportRows}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Guard</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No ledger entries yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.effective_date}</TableCell>
                  <TableCell>
                    <div>{nameOf(r.employees)}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.employees?.employee_code}
                    </div>
                  </TableCell>
                  <TableCell>{LEAVE_TYPE_LABEL[r.leave_type]}</TableCell>
                  <TableCell className="capitalize">{r.entry_type}</TableCell>
                  <TableCell
                    className={`text-right font-mono ${Number(r.units) < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {Number(r.units) > 0 ? "+" : ""}
                    {Number(r.units).toFixed(2)}
                  </TableCell>
                  <TableCell>{r.reference ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RequestDialog({
  open,
  onOpenChange,
  employees,
  policies,
  balances,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: Employee[];
  policies: LeavePolicy[];
  balances: Balance[];
  onSaved: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const [employee, setEmployee] = useState("");
  const [type, setType] = useState<LeaveType>("annual");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const balance = balanceFor(
    balances.find((b) => b.employee_id === employee),
    type,
  );
  const policy = policies.find((p) => p.leave_type === type);
  const { data: rosterPreview = [], isFetching: previewLoading } = useQuery({
    queryKey: ["leave-roster-preview", employee, start, end],
    enabled: open && !!employee && !!start && !!end && end >= start,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("date,planned_hours,shift_types(pay_rule)")
        .eq("employee_id", employee)
        .gte("date", start)
        .lte("date", end);
      if (error) throw error;
      return (data ?? []).filter((a) => {
        const rule = a.shift_types?.pay_rule ?? "standard";
        return rule !== "off" && rule !== "leave";
      }) as Array<{ date: string; planned_hours: number }>;
    },
  });
  const projectedDays = new Set(rosterPreview.map((a) => a.date)).size;
  const projectedHours = rosterPreview.reduce((sum, a) => sum + Number(a.planned_hours || 0), 0);
  const save = useMutation({
    mutationFn: async () => {
      if (!employee || !start || !end || !reason.trim())
        throw new Error("Employee, dates and reason are required");
      let uploadedPath: string | null = null;
      try {
        if (evidenceFile) {
          if (!profile?.tenant_id) throw new Error("Tenant profile is unavailable");
          if (evidenceFile.size > 10 * 1024 * 1024)
            throw new Error("Evidence must be 10 MB or smaller");
          if (!(evidenceFile.type === "application/pdf" || evidenceFile.type.startsWith("image/")))
            throw new Error("Evidence must be a PDF or image");
          const safeName = evidenceFile.name.replace(/[^\w.-]+/g, "_");
          uploadedPath = `${profile.tenant_id}/${employee}/${crypto.randomUUID()}-${safeName}`;
          const { error: uploadError } = await supabase.storage
            .from("leave-evidence")
            .upload(uploadedPath, evidenceFile, { contentType: evidenceFile.type, upsert: false });
          if (uploadError) throw uploadError;
        }
        const evidenceValue = uploadedPath
          ? `leave-evidence:${uploadedPath}`
          : evidence.trim() || undefined;
        const { error } = await supabase.rpc("submit_leave_request", {
          p_employee: employee,
          p_type: type,
          p_start: start,
          p_end: end,
          p_reason: reason.trim(),
          p_evidence_url: evidenceValue,
        });
        if (error) throw error;
      } catch (error) {
        if (uploadedPath) await supabase.storage.from("leave-evidence").remove([uploadedPath]);
        throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Leave request submitted");
      onOpenChange(false);
      setReason("");
      setEvidence("");
      setEvidenceFile(null);
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New leave request</DialogTitle>
          <DialogDescription>
            Operations will approve it separately; only rostered workdays consume the balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Employee">
            <Select value={employee} onValueChange={setEmployee}>
              <SelectTrigger>
                <SelectValue placeholder="Choose guard" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {nameOf(e)} · {e.employee_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Leave type">
              <Select value={type} onValueChange={(v) => setType(v as LeaveType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {policies
                    .filter((p) => p.active)
                    .map((p) => (
                      <SelectItem key={p.leave_type} value={p.leave_type}>
                        {p.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="rounded-md border p-2 text-xs">
              <div className="text-muted-foreground">Available balance</div>
              <div className="font-mono font-semibold">
                {balance == null ? "Not applicable" : `${balance.toFixed(2)} days`}
              </div>
              <div className="text-muted-foreground">
                {policy ? `${Number(policy.paid_percent)}% paid` : "Policy unavailable"}
              </div>
            </div>
          </div>
          {employee && start && end && (
            <div
              className={`rounded-md border p-3 text-sm ${!previewLoading && projectedDays === 0 ? "border-warning/50 bg-warning/5" : "bg-muted/30"}`}
            >
              <div className="font-medium">Roster impact preview</div>
              {previewLoading ? (
                <div className="text-muted-foreground">Checking published shifts…</div>
              ) : projectedDays > 0 ? (
                <div className="text-muted-foreground">
                  {projectedDays} rostered day{projectedDays === 1 ? "" : "s"},{" "}
                  {projectedHours.toFixed(2)} scheduled hours; approval will open{" "}
                  {rosterPreview.length} relief shift{rosterPreview.length === 1 ? "" : "s"}.
                </div>
              ) : (
                <div className="text-warning">
                  No published working shifts in this range. The request can be submitted, but
                  approval waits until the roster exists.
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Evidence document" hint="Private PDF or image, maximum 10 MB.">
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Field
            label="External evidence URL (optional)"
            hint="Use only when the document is already stored securely elsewhere."
          >
            <Input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceLink({ value }: { value: string }) {
  const open = async () => {
    if (!value.startsWith("leave-evidence:")) {
      window.open(value, "_blank", "noopener,noreferrer");
      return;
    }
    const path = value.slice("leave-evidence:".length);
    const { data, error } = await supabase.storage
      .from("leave-evidence")
      .createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open leave evidence");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <button type="button" className="text-xs text-primary underline" onClick={open}>
      Evidence
    </button>
  );
}

// UAT-15 — the statutory deadline picture, shown next to UAT-14's capacity figures so the
// approver holds both at once. Warn only: nothing here disables a button.
//
// The cap-versus-deadline collision (D-16) is deliberately NOT resolved. Decision §6 says to
// show the conflict and leave it with the human, so when both are live this panel names them
// side by side and says plainly that the system has no rule for which one wins.
function DeadlinePanel({
  risk,
  conflict,
  rejecting,
}: {
  risk: DeadlineRisk;
  conflict: boolean;
  rejecting: boolean;
}) {
  const urgent = risk.level === "overdue" || risk.level === "approaching";
  return (
    <div
      className={cn(
        "space-y-2 rounded-md border px-3 py-2 text-sm",
        risk.level === "overdue"
          ? "border-destructive/40 bg-destructive/10"
          : urgent
            ? "border-warning/40 bg-warning/10"
            : "border-border/60",
      )}
    >
      <div className="flex items-start gap-2">
        {urgent ? (
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="space-y-1">
          <p className="font-medium">Statutory deadline (Labour Act s.23)</p>
          <p className={urgent ? "" : "text-muted-foreground"}>{describeDeadlineRisk(risk)}</p>
          {risk.clearsDeadline === false && (
            <p className="text-muted-foreground">
              This request ends after the deadline, so approving it does not discharge the
              obligation on its own.
            </p>
          )}
        </div>
      </div>

      {conflict && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
          <p className="font-medium text-destructive">
            The monthly cap and the statutory deadline are both in play.
          </p>
          <p className="text-muted-foreground">
            The system does not decide between them. A headcount policy cannot override a legal
            deadline, so escalate rather than refusing on the cap alone.
          </p>
        </div>
      )}

      {rejecting && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
          <p className="font-medium text-destructive">
            You are rejecting leave that is against the statutory clock.
          </p>
          <p className="text-muted-foreground">
            Your reason is recorded on the request. If no alternative dates are offered, the
            employee may reach the deadline without having taken the leave.
          </p>
        </div>
      )}
    </div>
  );
}

// UAT-14 — the leave-capacity picture, shown to the approver before they decide.
// Warn only, by decision §6: every figure here is informational and the Approve button
// stays enabled throughout. A cap must never silently defeat a statutory leave deadline.
function CapacityPanel({
  loading,
  rows,
  warnings,
  siteName,
}: {
  loading: boolean;
  rows: CapacityRow[];
  warnings: CapacityWarning[];
  siteName: (id: string | null) => string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking leave capacity...
      </div>
    );
  }
  // No rows means no leave days were expanded for this request — nothing to assess.
  if (!rows.length) return null;

  const cap = rows[0].max_employees;
  const peakMonth = Math.max(...rows.map((r) => r.monthly_employee_count));
  const peakDay = Math.max(...rows.map((r) => r.approved_or_planned));

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border px-3 py-2 text-sm",
        warnings.length ? "border-warning/40 bg-warning/10" : "border-border/60",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Leave capacity</span>
        <span className="text-xs text-muted-foreground">
          Cap {cap} per month &middot; peak {peakMonth} this month &middot; peak {peakDay} on one
          day at this site
        </span>
      </div>
      {warnings.length ? (
        <ul className="space-y-1">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-warning-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{describeWarning(w, siteName)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          Within the monthly cap and clear on coverage at the employee&rsquo;s site.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        These are warnings, not blocks. Approving past them is allowed and is recorded with your
        reason.
      </p>
    </div>
  );
}

function DecisionDialog({
  value,
  sites,
  cycles,
  onOpenChange,
  onSaved,
}: {
  value: {
    id: string;
    action: "approve" | "reject" | "cancel";
    leaveType: LeaveType;
    employeeId: string;
    requestEnd: string;
  } | null;
  sites: { id: string; name: string }[];
  cycles: CycleRow[];
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const action = value?.action;

  // UAT-14: the capacity picture is only meaningful for annual leave being approved.
  // Sick and compassionate leave are not discretionary, so a headcount cap has no say.
  const wantsCapacity = action === "approve" && value?.leaveType === "annual";
  const { data: capacity = [], isLoading: capacityLoading } = useQuery({
    queryKey: ["leave-capacity", value?.id],
    enabled: wantsCapacity && !!value?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_annual_leave_capacity", {
        p_request: value!.id,
      });
      if (error) throw error;
      return (data ?? []) as CapacityRow[];
    },
  });
  const warnings = useMemo(() => capacityWarnings(capacity), [capacity]);

  // UAT-15: the statutory half of the picture. Shown for annual leave on both the approve and
  // the reject path — "never silently deny leave" means a rejection is exactly when the
  // approver most needs to know the clock is running.
  const isAnnual = value?.leaveType === "annual";
  const risk = useMemo<DeadlineRisk>(() => {
    const cycle = cycles.find(
      (c) => c.leave_type === "annual" && c.employees?.id === value?.employeeId,
    );
    return deadlineRisk({
      latestLeaveDate: cycle?.latest_leave_date ?? null,
      requestEnd: value?.requestEnd ?? null,
      today: new Date().toISOString().slice(0, 10),
    });
  }, [cycles, value?.employeeId, value?.requestEnd]);
  const conflict = hasCapacityDeadlineConflict(warnings, risk);
  const rejectWarning = isAnnual && action === "reject" && rejectionNeedsDeadlineWarning(risk);
  const siteName = (id: string | null) =>
    (id && sites.find((x) => x.id === id)?.name) || "an unassigned site";
  // §6: "the decision and its reason are recorded". decision_notes is where that reason
  // lives, so approving past a warning is the one approval that must carry a note.
  const reasonRequired = wantsCapacity && requiresReason(capacity);

  const save = useMutation({
    mutationFn: async () => {
      if (!value) return;
      if (action !== "approve" && !notes.trim()) throw new Error("A reason is required");
      if (reasonRequired && !notes.trim())
        throw new Error("This approval goes past a capacity warning, so a reason is required");
      const result =
        action === "approve"
          ? await supabase.rpc("approve_leave_request", {
              p_request: value.id,
              p_notes: notes.trim() || undefined,
            })
          : action === "reject"
            ? await supabase.rpc("reject_leave_request", {
                p_request: value.id,
                p_reason: notes.trim(),
              })
            : await supabase.rpc("cancel_leave_request", {
                p_request: value.id,
                p_reason: notes.trim(),
              });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success(
        action === "approve"
          ? "Leave approved — coverage created"
          : action === "reject"
            ? "Leave rejected"
            : "Leave cancelled and balance restored",
      );
      setNotes("");
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open={!!value} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="capitalize">{action} leave</DialogTitle>
          <DialogDescription>
            {action === "approve"
              ? "Approval checks policy and balance, changes rostered shifts to leave, and creates relief-cover requirements."
              : "This action is recorded in the audit trail."}
          </DialogDescription>
        </DialogHeader>
        {wantsCapacity && (
          <CapacityPanel
            loading={capacityLoading}
            rows={capacity}
            warnings={warnings}
            siteName={siteName}
          />
        )}
        {isAnnual && action !== "cancel" && (
          <DeadlinePanel risk={risk} conflict={conflict} rejecting={rejectWarning} />
        )}
        <Field
          label={
            action !== "approve"
              ? "Reason"
              : reasonRequired
                ? "Reason for approving past the warning (required)"
                : "Approval note (optional)"
          }
        >
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            variant={action === "approve" ? "default" : "destructive"}
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoverDialog({
  coverage,
  employees,
  onOpenChange,
  onSaved,
}: {
  coverage: CoverageRow | null;
  employees: Employee[];
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [employee, setEmployee] = useState("");
  const candidates = employees.filter((e) => e.id !== coverage?.leave_employee_id);
  const save = useMutation({
    mutationFn: async () => {
      if (!coverage || !employee) throw new Error("Choose a replacement guard");
      const { error } = await supabase.rpc("assign_leave_cover", {
        p_coverage: coverage.id,
        p_employee: employee,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Relief guard assigned");
      setEmployee("");
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open={!!coverage} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign relief guard</DialogTitle>
          <DialogDescription>
            {coverage
              ? `${coverage.coverage_date} · ${coverage.sites?.name} · ${coverage.planned_hours}h`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <Field label="Replacement">
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger>
              <SelectValue placeholder="Choose available guard" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {nameOf(e)} · {e.employee_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()}>Assign cover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WaiveDialog({
  coverage,
  onOpenChange,
  onSaved,
}: {
  coverage: CoverageRow | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!coverage || !reason.trim()) throw new Error("A waiver reason is required");
      const { error } = await supabase.rpc("waive_leave_cover", {
        p_coverage: coverage.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Coverage requirement waived with an audit reason");
      setReason("");
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open={!!coverage} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Waive relief coverage</DialogTitle>
          <DialogDescription>
            Use only when the site can safely operate without replacing this shift. The reason is
            permanent audit evidence.
          </DialogDescription>
        </DialogHeader>
        <Field label="Operational reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button variant="destructive" disabled={save.isPending} onClick={() => save.mutate()}>
            Confirm waiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({
  employee,
  onOpenChange,
  onSaved,
}: {
  employee: Employee | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [type, setType] = useState<Exclude<LeaveType, "unpaid" | "maternity">>("annual");
  const [units, setUnits] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!employee || !Number(units) || !reason.trim())
        throw new Error("Units and reason are required");
      const { error } = await supabase.rpc("adjust_leave_balance", {
        p_employee: employee.id,
        p_type: type,
        p_units: Number(units),
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Balance adjustment recorded");
      setUnits("");
      setReason("");
      await onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust leave balance</DialogTitle>
          <DialogDescription>
            {nameOf(employee)}. Use a negative number to reduce; every correction stays in the
            ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={type}
              onValueChange={(v) => setType(v as Exclude<LeaveType, "unpaid" | "maternity">)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="sick">Sick</SelectItem>
                <SelectItem value="compassionate">Compassionate</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Days (+/-)">
            <Input
              type="number"
              step="0.25"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()}>
            <CircleDollarSign className="h-4 w-4 mr-2" /> Record adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Policies({
  policies,
  onChanged,
}: {
  policies: LeavePolicy[];
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <CapacityPolicyCard />
      <div className="grid md:grid-cols-2 gap-4">
        {policies.map((p) => (
          <PolicyCard key={p.id} policy={p} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

// UAT-14 — the tenant-wide annual-leave headcount cap (decision §6: default 10, configurable
// with an effective date and a policy owner). Rows are effective-dated rather than edited in
// place: the cap that applied when an earlier approval was made stays on the record, so the
// history of "what was the rule that day" survives. Past rows are therefore read-only here.
function CapacityPolicyCard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [maxEmployees, setMaxEmployees] = useState("10");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["leave-capacity-policies", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("annual_leave_capacity_policies")
        .select("id,max_employees,effective_from,created_at,policy_owner")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data as {
        id: string;
        max_employees: number;
        effective_from: string;
        created_at: string;
        policy_owner: string;
      }[];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const current = rows.find((r) => r.effective_from <= today) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const n = Number(maxEmployees);
      if (!Number.isFinite(n) || n < 1) throw new Error("The cap must be at least 1");
      if (!profile?.id || !profile?.tenant_id) throw new Error("No profile");
      const { error } = await supabase.from("annual_leave_capacity_policies").insert({
        tenant_id: profile.tenant_id,
        max_employees: Math.trunc(n),
        effective_from: effectiveFrom,
        policy_owner: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Leave capacity cap saved");
      await qc.invalidateQueries({ queryKey: ["leave-capacity-policies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("annual_leave_capacity_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Future cap withdrawn");
      await qc.invalidateQueries({ queryKey: ["leave-capacity-policies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Annual leave capacity</CardTitle>
        <CardDescription>
          How many employees may be on annual leave in the same month. Approvers are warned when a
          request would push the month past this number, or when the employee&rsquo;s site is
          already short on the day &mdash; they are never blocked, so a headcount rule can never
          override a statutory leave deadline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          {isLoading
            ? "Loading..."
            : current
              ? `Currently capped at ${current.max_employees} per month, effective ${current.effective_from}.`
              : "No cap set. Approvers see the built-in default of 10."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Employees per month">
            <Input
              type="number"
              min={1}
              value={maxEmployees}
              onChange={(e) => setMaxEmployees(e.target.value)}
              className="w-32"
            />
          </Field>
          <Field label="Effective from">
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-44"
            />
          </Field>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save cap
          </Button>
        </div>
        {rows.length > 1 && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">History</p>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <span>
                  {r.max_employees} per month from {r.effective_from}
                  {r.id === current?.id ? " (current)" : ""}
                </span>
                {r.effective_from > today && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(r.id)}
                    disabled={remove.isPending}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function PolicyCard({
  policy,
  onChanged,
}: {
  policy: LeavePolicy;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(policy);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_leave_policy", {
        p_type: draft.leave_type,
        p_paid_percent: Number(draft.paid_percent),
        p_balance_enforced: draft.balance_enforced,
        p_allow_negative: draft.allow_negative,
        p_minimum_notice_days: Number(draft.minimum_notice_days),
        p_evidence_required_after_days:
          draft.evidence_required_after_days == null
            ? null
            : Number(draft.evidence_required_after_days),
        p_maximum_consecutive_days:
          draft.maximum_consecutive_days == null ? null : Number(draft.maximum_consecutive_days),
        p_active: draft.active,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(`${policy.label} policy updated`);
      await onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const set = (patch: Partial<LeavePolicy>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {policy.label}
          <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Paid %"
            hint={
              draft.leave_type === "maternity"
                ? "Employer-funded portion; Social Security benefits remain separate."
                : "Fixed by the statutory leave category."
            }
          >
            <Input
              type="number"
              min="0"
              max="100"
              value={draft.paid_percent}
              disabled={draft.leave_type !== "maternity"}
              onChange={(e) => set({ paid_percent: Number(e.target.value) })}
            />
          </Field>
          <Field label="Notice days">
            <Input
              type="number"
              min="0"
              value={draft.minimum_notice_days}
              disabled={["sick", "compassionate"].includes(draft.leave_type)}
              onChange={(e) => set({ minimum_notice_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Evidence after days">
            <Input
              type="number"
              min="0"
              value={draft.evidence_required_after_days ?? ""}
              onChange={(e) =>
                set({
                  evidence_required_after_days: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <Field label="Maximum consecutive">
            <Input
              type="number"
              min="0"
              value={draft.maximum_consecutive_days ?? ""}
              onChange={(e) =>
                set({ maximum_consecutive_days: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
        </div>
        <label className="flex justify-between text-sm">
          Enforce balance{" "}
          <Switch
            checked={draft.balance_enforced}
            disabled={["maternity", "unpaid"].includes(draft.leave_type)}
            onCheckedChange={(v) => set({ balance_enforced: v })}
          />
        </label>
        <label className="flex justify-between text-sm">
          Allow negative balance{" "}
          <Switch
            checked={draft.allow_negative}
            disabled={["maternity", "unpaid"].includes(draft.leave_type)}
            onCheckedChange={(v) => set({ allow_negative: v })}
          />
        </label>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          Save policy
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
