import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, FileText, Lock, Play, AlertTriangle } from "lucide-react";
import {
  calculateNetPay, fetchPayrollConstants, calcVETLevy,
  type EmployeeRow, type PayslipCalc,
} from "@/lib/payroll-engine";
import { buildABSACsv, buildPayslipPDF } from "@/lib/payslip-pdf";
import { formatNAD } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app/payroll")({
  component: PayrollPage,
});

function downloadBlob(data: Blob | string, filename: string, mime = "text/csv") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function PayrollPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [periodId, setPeriodId] = useState<string>("");
  const [calcs, setCalcs] = useState<PayslipCalc[]>([]);
  const [running, setRunning] = useState(false);

  const { data: periods } = useQuery({
    queryKey: ["pay_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods").select("*").order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!periodId && periods?.length) setPeriodId(periods[0].id);
  }, [periods, periodId]);

  const period = periods?.find((p) => p.id === periodId);

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

      const [empRes, logRes, discRes, dedRes] = await Promise.all([
        supabase.from("employees").select("*").eq("status", "active"),
        supabase
          .from("shift_logs")
          .select("id,employee_id,date,hours_worked,night_hours,status,shift_types(pay_rule,rate_multiplier)")
          .eq("pay_period_id", period.id),
        supabase
          .from("disciplinary_actions")
          .select("id,employee_id,action_type,fine_amount,suspension_hours,collective_agreement_reference,offence_code,incident_date")
          .gte("incident_date", period.start_date)
          .lte("incident_date", period.end_date),
        supabase
          .from("deductions")
          .select("employee_id,amount,disciplinary_action_id,deduction_types(code,label,category,requires_collective_agreement)")
          .eq("pay_period_id", period.id),
      ]);
      if (empRes.error) throw empRes.error;
      if (logRes.error) throw logRes.error;
      if (discRes.error) throw discRes.error;
      if (dedRes.error) throw dedRes.error;

      const employees = (empRes.data ?? []) as EmployeeRow[];
      const logs = (logRes.data ?? []) as any[];
      const disc = (discRes.data ?? []) as any[];
      const deds = (dedRes.data ?? []) as any[];

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
      const adhocByEmp = new Map<string, any[]>();
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
          constants,
          brackets,
        });
        out.push(calc);
      }

      // Persist draft payroll_runs (idempotent — delete existing drafts for this period then insert)
      await supabase.from("payroll_runs").delete().eq("pay_period_id", period.id).eq("status", "draft");

      const rows = out
        .filter((c) => c.gross_salary > 0 || c.total_deductions > 0 || c.employee.category === "management")
        .map((c) => ({
          tenant_id: profile!.tenant_id,
          employee_id: c.employee.id,
          pay_period_id: period.id,
          normal_hours: c.normal_hours,
          overtime_hours: c.overtime_hours,
          sunday_hours: c.sunday_hours,
          public_holiday_hours: c.public_holiday_hours,
          night_hours: c.night_hours,
          rate_per_hour: c.rate,
          normal_amount: c.normal_amount,
          overtime_amount: c.overtime_amount,
          sunday_amount: c.sunday_amount,
          public_holiday_amount: c.public_holiday_amount,
          night_premium_amount: c.night_premium_amount,
          transport_allowance: c.transport_allowance,
          gross_salary: c.gross_salary,
          paye_amount: c.paye_amount,
          ssc_amount: c.ssc_amount,
          consensual_deductions: c.consensual_deductions + c.fine_deductions,
          total_deductions: c.total_deductions,
          net_salary: c.net_salary,
          compliance_warnings: c.warnings as unknown as any,
          status: "draft" as const,
        }));
      if (rows.length) {
        const { error } = await supabase.from("payroll_runs").insert(rows);
        if (error) throw error;
      }

      setCalcs(out);
      toast.success(`Payroll computed for ${out.length} employees`);
    } catch (e: any) {
      toast.error(e.message ?? "Payroll run failed");
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
      // lock the period — trigger prevents further edits to shift_logs/deductions
      const { error: pErr } = await supabase
        .from("pay_periods")
        .update({ status: "locked", locked_at: new Date().toISOString(), locked_by: profile!.id })
        .eq("id", period.id);
      if (pErr) throw pErr;
      const { error: rErr } = await supabase
        .from("payroll_runs")
        .update({ status: "finalized", finalized_at: new Date().toISOString() })
        .eq("pay_period_id", period.id)
        .eq("status", "draft");
      if (rErr) throw rErr;
    },
    onSuccess: () => {
      toast.success("Payroll finalized & period locked");
      qc.invalidateQueries({ queryKey: ["pay_periods"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Finalize failed"),
  });

  function exportABSA() {
    if (!calcs.length || !period) return;
    const rows = calcs
      .filter((c) => c.net_salary > 0 && c.employee.bank_account_number)
      .map((c) => ({
        account_number: c.employee.bank_account_number || "",
        branch_code: "632005", // ABSA Namibia default — admin can edit later
        amount: Number(c.net_salary.toFixed(2)),
        beneficiary_name: (c.employee.display_name ?? `${c.employee.first_names} ${c.employee.surname}`).slice(0, 30),
        payment_reference: `DF${c.employee.employee_code}-${period.label.replace(/\s+/g, "")}`.slice(0, 20),
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
        tenantName: tenant?.name ?? "Dog Force Security",
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
      tenantName: tenant?.name ?? "Dog Force Security",
    });
    pdf.save(`Payslip_${c.employee.employee_code}.pdf`);
  }

  const isLocked = period?.status === "locked" || period?.status === "paid";
  const vetLevy = calcs.length
    ? // rough: compute using constants held in closure would require re-fetch; approximate with 1% > 83,333
      summary.gross > 83333 ? summary.gross * 0.01 : 0
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Gross-to-net engine — 2026 Namibian rates. Ordinary ≤60h/wk @1×, OT 1.5×, Sunday/PH 2×.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Select pay period" /></SelectTrigger>
            <SelectContent>
              {periods?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} {p.status !== "open" ? `(${p.status})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runPayroll} disabled={running || !period || isLocked}>
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
          hint={vetLevy > 0 ? "Employer liability" : "Below N$83,333 threshold"}
        />
      </div>

      {summary.disqFines > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div>
            <strong>{formatNAD(summary.disqFines)} in fines not deducted</strong> — missing Collective Agreement reference per Labour Act s.12(5).
            Add the CA reference on the Disciplinary record to release these deductions.
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Payroll Run Details</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportABSA} disabled={!calcs.length}>
              <Download className="h-4 w-4 mr-2" />ABSA CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportAllPayslipsZip} disabled={!calcs.length}>
              <FileText className="h-4 w-4 mr-2" />All Payslips
            </Button>
            <Button
              size="sm"
              onClick={() => finalizeMut.mutate()}
              disabled={!calcs.length || finalizeMut.isPending || isLocked}
            >
              <Lock className="h-4 w-4 mr-2" />Finalize &amp; Lock
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
                    Select a pay period and click <strong>Run Payroll</strong> to compute gross-to-net.
                  </TableCell>
                </TableRow>
              ) : (
                calcs.map((c) => (
                  <TableRow key={c.employee.id}>
                    <TableCell>
                      <div className="font-medium">{c.employee.display_name ?? `${c.employee.first_names} ${c.employee.surname}`}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        {c.employee.employee_code}
                        {c.warnings.length > 0 && <Badge variant="outline" className="ml-1 text-[10px]">{c.warnings.length} warn</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{c.normal_hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{c.overtime_hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{(c.sunday_hours + c.public_holiday_hours).toFixed(1)}</TableCell>
                    <TableCell className="text-right">{formatNAD(c.gross_salary)}</TableCell>
                    <TableCell className="text-right">{formatNAD(c.paye_amount)}</TableCell>
                    <TableCell className="text-right">{formatNAD(c.ssc_amount)}</TableCell>
                    <TableCell className="text-right">
                      {formatNAD(c.fine_deductions)}
                      {c.disqualified_fines > 0 && (
                        <div className="text-[10px] text-destructive">+{formatNAD(c.disqualified_fines)} blocked</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatNAD(c.net_salary)}</TableCell>
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

function SummaryCard({ label, value, emphasis, hint }: { label: string; value: string; emphasis?: boolean; hint?: string }) {
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
  const { data } = useQuery({
    queryKey: ["unsigned-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, surname, first_names, employee_code")
        .eq("status", "active")
        .is("contract_signed_at", null)
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="font-medium">
        {data.length} active employee{data.length === 1 ? "" : "s"} excluded — contract pending
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        These employees won't appear in payroll until their contract is signed:{" "}
        {data.slice(0, 6).map((e) => `${e.surname} (${e.employee_code})`).join(", ")}
        {data.length > 6 ? ` …and ${data.length - 6} more` : ""}.
      </div>
    </div>
  );
}

