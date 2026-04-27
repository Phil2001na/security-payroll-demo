import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, MapPin, Users, CalendarDays, ClipboardList,
  Calculator, ShieldAlert, Settings, ArrowRight, Sparkles, Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/wizard")({
  component: WizardPage,
  head: () => ({ meta: [{ title: "Getting Started — Dog Force Payroll" }] }),
});

type Step = {
  n: number;
  key: string;
  title: string;
  blurb: string;
  why: string;
  to: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
  count?: number;
  hint?: string;
};

function WizardPage() {
  const { profile } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["wizard-status", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const [
        constants, sites, shiftTypes, employees, assignments,
        shiftLogs, openPeriod, payrollRuns, disciplinary,
      ] = await Promise.all([
        supabase.from("payroll_constants").select("id", { count: "exact", head: true }),
        supabase.from("sites").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("shift_types").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("schedule_assignments").select("id", { count: "exact", head: true }),
        supabase.from("shift_logs").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("pay_periods").select("id, label, status, start_date, end_date").eq("status", "open").maybeSingle(),
        supabase.from("payroll_runs").select("id", { count: "exact", head: true }),
        supabase.from("disciplinary_actions").select("id", { count: "exact", head: true }),
      ]);

      return {
        constants: constants.count ?? 0,
        sites: sites.count ?? 0,
        shiftTypes: shiftTypes.count ?? 0,
        employees: employees.count ?? 0,
        assignments: assignments.count ?? 0,
        shiftLogs: shiftLogs.count ?? 0,
        openPeriod: openPeriod.data,
        payrollRuns: payrollRuns.count ?? 0,
        disciplinary: disciplinary.count ?? 0,
      };
    },
  });

  const steps: Step[] = [
    {
      n: 1, key: "constants", icon: Settings,
      title: "Verify payroll constants",
      blurb: "Confirm Namibian 2026 rates (min wage N$16, SSC 0.9%, PAYE threshold N$100k).",
      why: "Every paycheck math call reads these values live — wrong constants = wrong net pay.",
      to: "/admin/settings", cta: "Open Admin Settings",
      done: (data?.constants ?? 0) >= 4,
      count: data?.constants,
      hint: profile?.role === "admin" ? undefined : "Admin-only. Ask your admin to confirm.",
    },
    {
      n: 2, key: "sites", icon: MapPin,
      title: "Add your sites",
      blurb: "Create each client site. Supervisors are scoped by site_id via RLS.",
      why: "Every shift, assignment, and incident must belong to a site.",
      to: "/sites", cta: "Manage sites",
      done: (data?.sites ?? 0) > 0,
      count: data?.sites,
    },
    {
      n: 3, key: "employees", icon: Users,
      title: "Import / create employees",
      blurb: "Bulk import via CSV/Excel or add manually. Set hourly rate, bank, home site.",
      why: "Employees are the atomic unit for scheduling and payroll.",
      to: "/employees", cta: "Go to employees",
      done: (data?.employees ?? 0) > 0,
      count: data?.employees,
    },
    {
      n: 4, key: "schedule", icon: CalendarDays,
      title: "Build the roster",
      blurb: "Assign guards to shift templates per site. System blocks >60h/week without a PS exemption.",
      why: "The schedule is the plan that daily attendance confirms or corrects.",
      to: "/schedule", cta: "Open schedule",
      done: (data?.assignments ?? 0) > 0,
      count: data?.assignments,
    },
    {
      n: 5, key: "attendance", icon: ClipboardList,
      title: "Run daily muster",
      blurb: "Confirm present / absent / replacements. Approved shifts feed payroll automatically.",
      why: "calculateNetPay() only sees shift_logs with status = approved.",
      to: "/attendance", cta: "Open daily muster",
      done: (data?.shiftLogs ?? 0) > 0,
      count: data?.shiftLogs,
    },
    {
      n: 6, key: "disciplinary", icon: ShieldAlert,
      title: "Log disciplinary actions (optional)",
      blurb: "Record offences. Fines require a Collective Agreement reference (S.12(5) gate).",
      why: "Unpaid suspensions auto-zero hours; fines flow to deductions.",
      to: "/disciplinary", cta: "Open disciplinary",
      done: true, // optional step
      count: data?.disciplinary,
      hint: "Optional — only if you have offences this period.",
    },
    {
      n: 7, key: "payroll", icon: Calculator,
      title: "Process payroll & lock period",
      blurb: "Generate gross-to-net, export ABSA CSV + PDF payslips, then Finalize to lock the period.",
      why: "Locking prevents retrospective edits and creates an audit trail.",
      to: "/payroll", cta: "Open payroll run",
      done: (data?.payrollRuns ?? 0) > 0,
      count: data?.payrollRuns,
      hint: data?.openPeriod ? `Open period: ${data.openPeriod.label}` : "⚠ No open pay period",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-5xl mx-auto">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Setup wizard
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          The Dog Force workflow, end-to-end
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Work through these seven steps in order. Each step unlocks the data the next one needs.
          Status updates live from your database — {isLoading ? "checking…" : `${completed} of ${steps.length} done (${pct}%)`}.
        </p>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-3">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      <ol className="space-y-4">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.key}>
              <Card className={cn("relative overflow-hidden transition-colors", s.done && "border-success/40 bg-success/[0.02]")}>
                <CardHeader className="flex-row items-start gap-4 space-y-0">
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono font-bold text-sm",
                    s.done ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
                  )}>
                    {s.done ? <CheckCircle2 className="h-5 w-5" /> : s.n}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="font-display text-lg">{s.title}</CardTitle>
                      {isLoading ? (
                        <Skeleton className="h-5 w-14" />
                      ) : s.done ? (
                        <Badge variant="default" className="bg-success text-success-foreground">Done</Badge>
                      ) : (
                        <Badge variant="outline">To do</Badge>
                      )}
                      {typeof s.count === "number" && s.count > 0 && (
                        <Badge variant="secondary" className="font-mono">{s.count}</Badge>
                      )}
                    </div>
                    <CardDescription className="mt-1.5">{s.blurb}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pl-[4.5rem] pt-0">
                  <p className="text-xs text-muted-foreground mb-3">
                    <span className="font-semibold text-foreground">Why it matters: </span>{s.why}
                  </p>
                  {s.hint && (
                    <p className="text-xs text-warning-foreground/80 mb-3 flex items-center gap-1.5">
                      {s.hint.includes("Admin-only") && <Lock className="h-3 w-3" />}
                      {s.hint}
                    </p>
                  )}
                  <Button asChild size="sm" variant={s.done ? "outline" : "default"}>
                    <Link to={s.to}>
                      {s.cta} <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="font-display text-base">Test checklist (what I'd try first)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. <strong className="text-foreground">Admin Settings</strong> → confirm the 4 constants exist and match 2026 rates.</p>
          <p>2. <strong className="text-foreground">Sites</strong> → create 2 sites (e.g. "Woermann Windhoek", "FNB Katutura").</p>
          <p>3. <strong className="text-foreground">Employees</strong> → either use the 20 seeded guards, or test the CSV importer with a messy Excel file.</p>
          <p>4. <strong className="text-foreground">Schedule</strong> → drop 12h Day + 12h Night onto a guard for 7 days straight and watch the 60h validator fire.</p>
          <p>5. <strong className="text-foreground">Attendance</strong> → mark one guard absent today and use "Replace" to see relief-guard suggestions.</p>
          <p>6. <strong className="text-foreground">Disciplinary</strong> → try to save a "Sleeping" fine without a Collective Agreement ref → should be blocked.</p>
          <p>7. <strong className="text-foreground">Payroll</strong> → generate the run, download one PDF payslip, download ABSA CSV, then Finalize → lock.</p>
        </CardContent>
      </Card>
    </div>
  );
}
