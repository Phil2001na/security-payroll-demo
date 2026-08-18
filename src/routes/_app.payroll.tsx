import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Download, FileText, Lock, Play, AlertTriangle, ShieldAlert } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  calculateNetPay,
  fetchPayrollConstants,
  calcVETLevy,
  weekKeyOf,
  round2,
  type EmployeeRow,
  type PayslipCalc,
  type PayrollConstants,
  type AdhocDeductionRow,
  type DisciplinaryRow,
  type ShiftLogRow,
} from "@/lib/payroll-engine";
import type { Tables } from "@/integrations/supabase/types";
import { buildABSACsv, buildPayslipPDF } from "@/lib/payslip-pdf";
import { formatNAD, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import {
  affectsPay,
  disciplinaryActionLabel,
  disciplinaryBadgeClass,
  fetchRecorderProfiles,
  recordedByLabel,
  type RecorderProfile,
} from "@/lib/disciplinary";
import { APPROVAL_LABELS, approvalBadgeClass, type ApprovalStatus } from "@/lib/approvals";
import { AccessDenied } from "@/components/access-denied";

export const Route = createFileRoute("/_app/payroll")({
  component: PayrollPage,
});

// Reconstructs a PayslipCalc from an already-saved payroll_runs row (joined with its
// employee) so previously computed/finalized periods can be redisplayed without rerunning
// the engine. fine_deductions/disqualified_fines/suspended_hours aren't persisted as their
// own columns — fines were folded into consensual_deductions at save time (see
// runPayroll below) — so they read back as 0 here; totals (gross/PAYE/SSC/net) are exact.
type PayrollRunWithEmployee = Tables<"payroll_runs"> & { employees: EmployeeRow };

function payrollRunToCalc(pr: PayrollRunWithEmployee): PayslipCalc {
  return {
    employee: pr.employees as EmployeeRow,
    rate: Number(pr.rate_per_hour) || 0,
    normal_hours: Number(pr.normal_hours) || 0,
    overtime_hours: Number(pr.overtime_hours) || 0,
    annual_leave_hours: Number(pr.annual_leave_hours) || 0,
    sick_leave_hours: Number(pr.sick_leave_hours) || 0,
    compassionate_leave_hours: Number(pr.compassionate_leave_hours) || 0,
    maternity_leave_hours: Number(pr.maternity_leave_hours) || 0,
    maternity_paid_hours: Number(pr.maternity_paid_hours) || 0,
    unpaid_leave_hours: Number(pr.unpaid_leave_hours) || 0,
    sunday_hours: Number(pr.sunday_hours) || 0,
    sunday_callin_hours: Number(pr.sunday_callin_hours) || 0,
    public_holiday_hours: Number(pr.public_holiday_hours) || 0,
    night_hours: Number(pr.night_hours) || 0,
    suspended_hours: 0,
    normal_amount: Number(pr.normal_amount) || 0,
    overtime_amount: Number(pr.overtime_amount) || 0,
    sunday_amount: Number(pr.sunday_amount) || 0,
    sunday_callin_amount: Number(pr.sunday_callin_amount) || 0,
    public_holiday_amount: Number(pr.public_holiday_amount) || 0,
    night_premium_amount: Number(pr.night_premium_amount) || 0,
    transport_allowance: Number(pr.transport_allowance) || 0,
    gross_salary: Number(pr.gross_salary) || 0,
    paye_amount: Number(pr.paye_amount) || 0,
    ssc_amount: Number(pr.ssc_amount) || 0,
    fine_deductions: 0,
    disqualified_fines: 0,
    consensual_deductions: Number(pr.consensual_deductions) || 0,
    total_deductions: Number(pr.total_deductions) || 0,
    net_salary: Number(pr.net_salary) || 0,
    warnings: Array.isArray(pr.compliance_warnings)
      ? pr.compliance_warnings.filter((value): value is string => typeof value === "string")
      : [],
  };
}

type DisciplinaryFlagRow = {
  id: string;
  employee_id: string;
  action_type: string;
  offence_code: string;
  incident_date: string;
  description: string | null;
  fine_amount: number | null;
  suspension_hours: number | null;
  collective_agreement_reference: string | null;
  status: ApprovalStatus;
  recorded_by: RecorderProfile | null;
};

type PayrollDisciplinaryRow = DisciplinaryRow & { incident_date: string };

function downloadBlob(data: Blob | string, filename: string, mime = "text/csv") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PayrollPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const hasPayrollAccess = !role || role === "admin" || role === "operations" || role === "payroll";
  // Running/finalizing a payroll run is restricted to the payroll role only (separation of
  // duties) — admin/operations can view this page but can't trigger either action.
  const canRunPayroll = role === "payroll";
  const qc = useQueryClient();
  const [periodId, setPeriodId] = useState<string>("");
  const [calcs, setCalcs] = useState<PayslipCalc[]>([]);
  const [running, setRunning] = useState(false);
  const [constants, setConstants] = useState<PayrollConstants | null>(null);

  const { data: periods } = useQuery({
    queryKey: ["pay_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!periodId && periods?.length) setPeriodId(periods[0].id);
  }, [periods, periodId]);

  const period = periods?.find((p) => p.id === periodId);

  // Draft/finalized payroll_runs already saved for the selected period. This is what
  // populates the table when you open a period you (or a previous session) already ran
  // — without it, `calcs` only ever holds whatever the last "Run Payroll" click computed
  // in the current browser session, so a locked/finalized period looked empty even though
  // its numbers are sitting in the DB.
  const { data: existingRuns } = useQuery({
    queryKey: ["payroll_runs", periodId],
    enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, employees(*)")
        .eq("pay_period_id", periodId)
        .order("employee_id");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!periodId) return;
    setCalcs((existingRuns ?? []).map(payrollRunToCalc));
  }, [existingRuns, periodId]);

  // Disciplinary actions falling inside the selected period, with the name/role of whoever
  // recorded them. Payroll reads this while verifying a run: a supervisor flagging a guard
  // (sleeping on duty, AWOL, …) has to be visible on the guard's payroll row *before*
  // Finalize & Lock, not buried in the Disciplinary page.
  const { data: periodFlags } = useQuery({
    queryKey: ["payroll-disciplinary", periodId],
    enabled: !!period,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disciplinary_actions")
        .select(
          "id,employee_id,action_type,offence_code,incident_date,description,fine_amount,suspension_hours,collective_agreement_reference,created_by,status",
        )
        .gte("incident_date", period!.start_date)
        .lte("incident_date", period!.end_date)
        .order("incident_date", { ascending: false });
      if (error) throw error;
      const recorders = await fetchRecorderProfiles((data ?? []).map((d) => d.created_by));
      return (data ?? []).map((d) => ({
        ...d,
        recorded_by: d.created_by ? (recorders.get(d.created_by) ?? null) : null,
      })) as DisciplinaryFlagRow[];
    },
  });

  const flagsByEmployee = useMemo(() => {
    const m = new Map<string, DisciplinaryFlagRow[]>();
    for (const f of periodFlags ?? []) {
      const arr = m.get(f.employee_id) ?? [];
      arr.push(f);
      m.set(f.employee_id, arr);
    }
    return m;
  }, [periodFlags]);

  useEffect(() => {
    fetchPayrollConstants()
      .then(({ constants }) => setConstants(constants))
      .catch(() => {});
  }, []);

  const { data: tenant } = useQuery({
    queryKey: ["tenant"],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  async function runPayroll() {
    if (!period) return;
    setRunning(true);
    try {
      const { constants, brackets } = await fetchPayrollConstants();
      setConstants(constants);

      const [empRes, logRes, discRes, dedRes, exRes, holRes, asgRes, tenantRes] = await Promise.all(
        [
          supabase.from("employees").select("*").eq("status", "active"),
          supabase
            .from("shift_logs")
            .select(
              "id,employee_id,date,hours_worked,night_hours,status,schedule_assignments:assignment_id(is_replacement,planned_hours),shift_types(code,is_leave,pay_rule,rate_multiplier,start_min,end_min,period)",
            )
            .eq("pay_period_id", period.id),
          // Only *confirmed* actions move money or zero out hours — a fine that hasn't been
          // through record → verify → confirm has no business on a payslip.
          supabase
            .from("disciplinary_actions")
            .select(
              "id,employee_id,action_type,fine_amount,suspension_hours,collective_agreement_reference,offence_code,incident_date",
            )
            .eq("status", "confirmed")
            .gte("incident_date", period.start_date)
            .lte("incident_date", period.end_date),
          supabase
            .from("deductions")
            .select(
              "employee_id,amount,disciplinary_action_id,deduction_types(code,label,category,requires_collective_agreement)",
            )
            .eq("pay_period_id", period.id),
          supabase
            .from("ps_exemptions")
            .select("employee_id,effective_from,effective_to")
            .lte("effective_from", period.end_date)
            .gte("effective_to", period.start_date),
          // All public holidays for the tenant (RLS-scoped) — fetched unfiltered so a
          // night shift on the last day of the period that crosses into a holiday the
          // morning after is still classified correctly.
          supabase.from("public_holidays").select("date"),
          // Rostered days per guard — the denominator for transport proration.
          supabase
            .from("schedule_assignments")
            .select("employee_id,date,leave_request_day_id,shift_types(pay_rule)")
            .gte("date", period.start_date)
            .lte("date", period.end_date),
          supabase.from("tenants").select("night_premium_enabled").limit(1).maybeSingle(),
        ],
      );
      if (empRes.error) throw empRes.error;
      if (logRes.error) throw logRes.error;
      if (discRes.error) throw discRes.error;
      if (dedRes.error) throw dedRes.error;
      if (exRes.error) throw exRes.error;
      if (holRes.error) throw holRes.error;
      if (asgRes.error) throw asgRes.error;

      const employees = (empRes.data ?? []) as EmployeeRow[];
      const logs = (logRes.data ?? []) as ShiftLogRow[];
      const disc = (discRes.data ?? []) as PayrollDisciplinaryRow[];
      const deds = dedRes.data ?? [];
      const exemptions = exRes.data ?? [];
      // Distinct originally rostered dates per employee. Approved leave remains in the
      // denominator so transport is not paid for a day on which the guard did not travel.
      const rosteredDaysByEmp = new Map<string, Set<string>>();
      for (const a of asgRes.data ?? []) {
        const rule = a.shift_types?.pay_rule ?? "standard";
        if (rule === "off" && !a.leave_request_day_id) continue;
        const set = rosteredDaysByEmp.get(a.employee_id) ?? new Set<string>();
        set.add(String(a.date).slice(0, 10));
        rosteredDaysByEmp.set(a.employee_id, set);
      }

      const publicHolidayDates = new Set<string>(
        (holRes.data ?? []).map((h) => String(h.date).slice(0, 10)),
      );
      const nightPremiumEnabled = tenantRes.data?.night_premium_enabled ?? true;

      // Map each employee to the ISO-week keys covered by a PS exemption, so the
      // engine can suppress the >cap compliance warning for those weeks.
      const exemptWeeksByEmp = new Map<string, Set<string>>();
      for (const ex of exemptions) {
        const set = exemptWeeksByEmp.get(ex.employee_id) ?? new Set<string>();
        const from = new Date(ex.effective_from + "T00:00:00Z");
        const to = new Date(ex.effective_to + "T00:00:00Z");
        for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
          set.add(weekKeyOf(d.toISOString().slice(0, 10)));
        }
        exemptWeeksByEmp.set(ex.employee_id, set);
      }

      // Build a suspension-date map per employee from disciplinary_actions of type unpaid_suspension
      const suspensionByEmp = new Map<string, Set<string>>();
      for (const d of disc) {
        if (d.action_type === "unpaid_suspension") {
          const set = suspensionByEmp.get(d.employee_id) ?? new Set<string>();
          // For v1 we zero out the incident_date itself; suspension_hours is captured separately
          set.add(d.incident_date);
          suspensionByEmp.set(d.employee_id, set);
        }
      }

      // Ad-hoc deductions keyed by employee — these come from attendance / incident logging
      const adhocByEmp = new Map<string, AdhocDeductionRow[]>();
      for (const d of deds) {
        const arr = adhocByEmp.get(d.employee_id) ?? [];
        arr.push({
          employee_id: d.employee_id,
          amount: Number(d.amount || 0),
          requires_ca: !!d.deduction_types?.requires_collective_agreement,
          // If linked to a disciplinary action, reuse its CA ref status
          has_ca_ref: d.disciplinary_action_id
            ? !!disc.find((x) => x.id === d.disciplinary_action_id)?.collective_agreement_reference
            : true, // non-offence deductions (loans, recovery, union) don't need CA
          label: d.deduction_types?.label,
        });
        adhocByEmp.set(d.employee_id, arr);
      }

      const out: PayslipCalc[] = [];
      for (const emp of employees) {
        const empLogs = logs.filter((l) => l.employee_id === emp.id);
        const empDisc = disc.filter((d) => d.employee_id === emp.id);
        const calc = calculateNetPay({
          employee: emp,
          logs: empLogs,
          disciplinary: empDisc,
          adhocDeductions: adhocByEmp.get(emp.id) ?? [],
          suspensionDates: suspensionByEmp.get(emp.id),
          psExemptWeekKeys: exemptWeeksByEmp.get(emp.id),
          publicHolidayDates,
          rosteredDays: rosteredDaysByEmp.get(emp.id)?.size ?? 0,
          nightPremiumEnabled,
          constants,
          brackets,
        });
        out.push(calc);
      }

      // Persist draft payroll_runs atomically (delete existing drafts + insert in one txn).
      const rows = out
        .filter(
          (c) =>
            c.gross_salary > 0 || c.total_deductions > 0 || c.employee.category === "management",
        )
        .map((c) => ({
          employee_id: c.employee.id,
          normal_hours: c.normal_hours,
          overtime_hours: c.overtime_hours,
          annual_leave_hours: c.annual_leave_hours,
          sick_leave_hours: c.sick_leave_hours,
          compassionate_leave_hours: c.compassionate_leave_hours,
          maternity_leave_hours: c.maternity_leave_hours,
          maternity_paid_hours: c.maternity_paid_hours,
          unpaid_leave_hours: c.unpaid_leave_hours,
          sunday_hours: c.sunday_hours,
          sunday_callin_hours: c.sunday_callin_hours,
          public_holiday_hours: c.public_holiday_hours,
          night_hours: c.night_hours,
          rate_per_hour: c.rate,
          normal_amount: c.normal_amount,
          overtime_amount: c.overtime_amount,
          sunday_amount: c.sunday_amount,
          sunday_callin_amount: c.sunday_callin_amount,
          public_holiday_amount: c.public_holiday_amount,
          night_premium_amount: c.night_premium_amount,
          transport_allowance: c.transport_allowance,
          gross_salary: c.gross_salary,
          paye_amount: c.paye_amount,
          ssc_amount: c.ssc_amount,
          consensual_deductions: round2(c.consensual_deductions + c.fine_deductions),
          total_deductions: c.total_deductions,
          net_salary: c.net_salary,
          compliance_warnings: c.warnings,
        }));
      const { error: rpcErr } = await supabase.rpc("replace_draft_payroll", {
        p_period: period.id,
        p_rows: rows,
      });
      if (rpcErr) throw rpcErr;

      setCalcs(out);
      toast.success(`Payroll computed for ${out.length} employees`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Payroll run failed");
    } finally {
      setRunning(false);
    }
  }

  const summary = useMemo(() => {
    const totals = calcs.reduce(
      (a, c) => ({
        gross: a.gross + c.gross_salary,
        paye: a.paye + c.paye_amount,
        ssc: a.ssc + c.ssc_amount,
        fines: a.fines + c.fine_deductions,
        disqFines: a.disqFines + c.disqualified_fines,
        net: a.net + c.net_salary,
        warn: a.warn + c.warnings.length,
      }),
      { gross: 0, paye: 0, ssc: 0, fines: 0, disqFines: 0, net: 0, warn: 0 },
    );
    return totals;
  }, [calcs]);

  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!period) throw new Error("no period");
      // Single transaction: finalize runs (posts to the ledger) then lock the period.
      const { error } = await supabase.rpc("finalize_payroll_period", { p_period: period.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payroll finalized & period locked");
      qc.invalidateQueries({ queryKey: ["pay_periods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Finalize failed"),
  });

  function exportABSA() {
    if (!calcs.length || !period) return;
    const rows = calcs
      .filter((c) => c.net_salary > 0 && c.employee.bank_account_number)
      .map((c) => ({
        account_number: c.employee.bank_account_number || "",
        branch_code: "632005", // ABSA Namibia default — admin can edit later
        amount: Number(c.net_salary.toFixed(2)),
        beneficiary_name: (
          c.employee.display_name ?? `${c.employee.first_names} ${c.employee.surname}`
        ).slice(0, 30),
        payment_reference:
          `DF${c.employee.employee_code}-${period.label.replace(/\s+/g, "")}`.slice(0, 20),
      }));
    const csv = buildABSACsv(rows);
    downloadBlob(csv, `ABSA_${period.label.replace(/\s+/g, "_")}.csv`);
  }

  function exportAllPayslipsZip() {
    // Simple approach: download individually as separate PDFs
    calcs.forEach((c) => {
      if (c.gross_salary <= 0) return;
      const pdf = buildPayslipPDF({
        calc: c,
        periodLabel: period!.label,
        periodStart: period!.start_date,
        periodEnd: period!.end_date,
        tenantName: tenant?.name ?? "Demo Payroll System",
      });
      pdf.save(`Payslip_${c.employee.employee_code}_${period!.label.replace(/\s+/g, "_")}.pdf`);
    });
  }

  function downloadOnePayslip(c: PayslipCalc) {
    const pdf = buildPayslipPDF({
      calc: c,
      periodLabel: period!.label,
      periodStart: period!.start_date,
      periodEnd: period!.end_date,
      tenantName: tenant?.name ?? "Demo Payroll System",
    });
    pdf.save(`Payslip_${c.employee.employee_code}.pdf`);
  }

  const isLocked = period?.status === "locked" || period?.status === "paid";
  const vetLevy = calcs.length && constants ? calcVETLevy(summary.gross, constants) : 0;

  if (!hasPayrollAccess) {
    return <AccessDenied message="Payroll access is restricted to payroll and operations staff." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Gross-to-net engine — industry-standard rates. Ordinary ≤60h/wk @1×, OT 1.5×, rostered
            Sunday 1.5× by contract, Sunday replacement call-in 2×, public holiday 2×.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Select pay period" />
            </SelectTrigger>
            <SelectContent>
              {periods?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} {p.status !== "open" ? `(${p.status})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={runPayroll}
            disabled={running || !period || isLocked || !canRunPayroll}
            title={!canRunPayroll ? "Only the payroll role can run payroll" : undefined}
          >
            <Play className="h-4 w-4 mr-2" />
            {running ? "Running…" : "Run Payroll"}
          </Button>
        </div>
      </div>

      {isLocked && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <Lock className="h-4 w-4 text-amber-600" />
          This period is <strong className="mx-1">{period?.status}</strong> — no edits permitted.
        </div>
      )}

      <UnsignedNotice />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total Gross" value={formatNAD(summary.gross)} />
        <SummaryCard label="PAYE" value={formatNAD(summary.paye)} />
        <SummaryCard label="SSC" value={formatNAD(summary.ssc)} />
        <SummaryCard label="Total Net" value={formatNAD(summary.net)} emphasis />
        <SummaryCard
          label="VET Levy (1%)"
          value={formatNAD(vetLevy)}
          hint={
            vetLevy > 0
              ? "Employer liability"
              : `Below ${formatNAD(constants?.vet_threshold ?? 83333)} threshold`
          }
        />
      </div>

      {flagsByEmployee.size > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <ShieldAlert className="h-4 w-4 text-warning mt-0.5" />
          <div>
            <strong>
              {flagsByEmployee.size} guard{flagsByEmployee.size === 1 ? "" : "s"} flagged this
              period
            </strong>{" "}
            — {periodFlags?.length} disciplinary action{periodFlags?.length === 1 ? "" : "s"}{" "}
            recorded by supervisors. Hover the flag on a guard's row to see the offence and who
            recorded it before finalizing.
          </div>
        </div>
      )}

      {summary.disqFines > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div>
            <strong>{formatNAD(summary.disqFines)} in fines not deducted</strong> — missing
            Collective Agreement reference per Labour Act s.12(5). Add the CA reference on the
            Disciplinary record to release these deductions.
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Payroll Run Details</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportABSA} disabled={!calcs.length}>
              <Download className="h-4 w-4 mr-2" />
              ABSA CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportAllPayslipsZip}
              disabled={!calcs.length}
            >
              <FileText className="h-4 w-4 mr-2" />
              All Payslips
            </Button>
            <Button
              size="sm"
              onClick={() => finalizeMut.mutate()}
              disabled={!calcs.length || finalizeMut.isPending || isLocked || !canRunPayroll}
              title={!canRunPayroll ? "Only the payroll role can finalize payroll" : undefined}
            >
              <Lock className="h-4 w-4 mr-2" />
              Finalize &amp; Lock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Normal</TableHead>
                <TableHead className="text-right">OT</TableHead>
                <TableHead className="text-right">Sun/PH</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">PAYE</TableHead>
                <TableHead className="text-right">SSC</TableHead>
                <TableHead className="text-right">Fines</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calcs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    Select a pay period and click <strong>Run Payroll</strong> to compute
                    gross-to-net.
                  </TableCell>
                </TableRow>
              ) : (
                calcs.map((c) => (
                  <TableRow key={c.employee.id}>
                    <TableCell>
                      <div className="font-medium">
                        {c.employee.display_name ??
                          `${c.employee.first_names} ${c.employee.surname}`}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {c.employee.employee_code}
                        {c.warnings.length > 0 && (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            {c.warnings.length} warn
                          </Badge>
                        )}
                        <DisciplinaryFlag flags={flagsByEmployee.get(c.employee.id)} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{c.normal_hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{c.overtime_hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right">
                      {(c.sunday_hours + c.sunday_callin_hours + c.public_holiday_hours).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">{formatNAD(c.gross_salary)}</TableCell>
                    <TableCell className="text-right">{formatNAD(c.paye_amount)}</TableCell>
                    <TableCell className="text-right">{formatNAD(c.ssc_amount)}</TableCell>
                    <TableCell className="text-right">
                      {formatNAD(c.fine_deductions)}
                      {c.disqualified_fines > 0 && (
                        <div className="text-[10px] text-destructive">
                          +{formatNAD(c.disqualified_fines)} blocked
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatNAD(c.net_salary)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => downloadOnePayslip(c)}>
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// The payroll-side indicator for issue #1: one badge per guard summarising the disciplinary
// actions a supervisor logged inside this pay period, expanded on hover.
function DisciplinaryFlag({ flags }: { flags?: DisciplinaryFlagRow[] }) {
  if (!flags?.length) return null;
  const payAffecting = flags.filter(affectsPay).length;
  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="ml-1 text-[10px] cursor-help bg-warning/15 text-warning border-warning/40"
        >
          <ShieldAlert className="h-3 w-3 mr-1" />
          {flags.length} disciplinary{payAffecting > 0 ? ` · ${payAffecting} affects pay` : ""}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 text-xs space-y-2">
        {flags.map((f) => (
          <div key={f.id} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-[10px] ${disciplinaryBadgeClass(f.action_type)}`}
              >
                {disciplinaryActionLabel(f.action_type)}
              </Badge>
              <Badge variant="outline" className={`text-[10px] ${approvalBadgeClass(f.status)}`}>
                {APPROVAL_LABELS[f.status]}
              </Badge>
              <span className="font-medium">{f.offence_code}</span>
              <span className="text-muted-foreground">{formatDate(f.incident_date)}</span>
            </div>
            <div className="text-muted-foreground">
              Recorded by {recordedByLabel(f.recorded_by)}
              {Number(f.fine_amount || 0) > 0 && <> · fine {formatNAD(Number(f.fine_amount))}</>}
              {Number(f.suspension_hours || 0) > 0 && <> · {Number(f.suspension_hours)}h unpaid</>}
              {f.action_type === "fine_with_ca" && !f.collective_agreement_reference?.trim() && (
                <span className="text-destructive"> · CA ref missing, fine not deducted</span>
              )}
              {affectsPay(f) && f.status !== "confirmed" && (
                <span className="text-destructive"> · not confirmed, excluded from this run</span>
              )}
            </div>
            {f.description && <div className="text-muted-foreground italic">“{f.description}”</div>}
          </div>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

function SummaryCard({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <Card className={emphasis ? "border-primary" : ""}>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${emphasis ? "text-primary" : ""}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function UnsignedNotice() {
  return null;
}
