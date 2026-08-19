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

export const Route = createFileRoute("/_app/leave")({ component: LeavePage });

type Employee = {
  id: string;
  first_names: string;
  surname: string;
  employee_code: string;
  status: string;
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
  employees: Employee | null;
};

function nameOf(e: Employee | null | undefined) {
  return e ? `${e.surname}, ${e.first_names}` : "Unknown employee";
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
        .select("id,first_names,surname,employee_code,status")
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
          "id,cycle_start,cycle_end,leave_type,entitlement_units,employees:employee_id(id,first_names,surname,employee_code,status)",
        )
        .gte("cycle_end", new Date().toISOString().slice(0, 10))
        .order("cycle_end");
      if (error) throw error;
      return data as unknown as CycleRow[];
    },
  });

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
        {canViewLedger && (
          <TabsContent value="ledger">
            <div className="space-y-4">
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
  onDecision: (v: { id: string; action: "approve" | "reject" | "cancel" }) => void;
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
                            onClick={() => onDecision({ id: r.id, action: "approve" })}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDecision({ id: r.id, action: "reject" })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {r.status === "approved" && canApprove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDecision({ id: r.id, action: "cancel" })}
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
              <TableHead className="text-right">Entitlement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No active cycle records yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{nameOf(row.employees)}</TableCell>
                  <TableCell>{LEAVE_TYPE_LABEL[row.leave_type]}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.cycle_start} — {row.cycle_end}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(row.entitlement_units).toFixed(2)}d
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

function DecisionDialog({
  value,
  onOpenChange,
  onSaved,
}: {
  value: { id: string; action: "approve" | "reject" | "cancel" } | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const action = value?.action;
  const save = useMutation({
    mutationFn: async () => {
      if (!value) return;
      if (action !== "approve" && !notes.trim()) throw new Error("A reason is required");
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
        <Field label={action === "approve" ? "Approval note (optional)" : "Reason"}>
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
    <div className="grid md:grid-cols-2 gap-4">
      {policies.map((p) => (
        <PolicyCard key={p.id} policy={p} onChanged={onChanged} />
      ))}
    </div>
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
