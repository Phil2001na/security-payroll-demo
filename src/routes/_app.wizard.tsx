import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, MapPin, Users, CalendarDays, ClipboardList,
  Calculator, ShieldAlert, Settings, ArrowRight, Sparkles, Lock,
  Building2, Flag, Layers, UserPlus, UserCog, ClipboardCheck, CalendarOff,
  BookOpen, Receipt, BrainCircuit, Boxes,
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
  head: () => ({ meta: [{ title: "Getting Started — Demo Payroll System" }] }),
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

type ExtraModule = {
  label: string;
  blurb: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  note?: string;
};

const EXTRA_MODULES: ExtraModule[] = [
  {
    label: "Clients & Invoices", icon: Receipt, to: "/invoices",
    blurb: "Bill clients, track partial payments and per-receipt ledger postings.",
    note: "Visible to admin/accountant roles.",
  },
  {
    label: "Accounting", icon: BookOpen, to: "/accounting",
    blurb: "General ledger fed by payroll runs and invoice postings.",
    note: "Visible to admin/accountant/CEO-executive.",
  },
  {
    label: "Equipment & Inventory", icon: Boxes, to: "/equipment",
    blurb: "Track issued gear, stock levels, and maintenance.",
  },
  {
    label: "AI Assistant", icon: BrainCircuit, to: "/ai-assistant",
    blurb: "Ask questions over your payroll/HR data, generate PDFs and charts.",
    note: "Visible to admin and CEO-executive only.",
  },
];

function WizardPage() {
  const { profile } = useAuth();
  const isAdminOrCeo = profile?.role === "admin" || profile?.is_ceo_executive === true;

  const { data, isLoading } = useQuery({
    queryKey: ["wizard-status", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const [
        tenant, constants, publicHolidays, sites, shiftTypes, employees, profiles,
        assignments, shiftLogsTotal, shiftLogsApproved, leavePolicies,
        openPeriod, payrollRuns, disciplinary,
      ] = await Promise.all([
        supabase.from("tenants").select("legal_name, bank_account_number").limit(1).maybeSingle(),
        supabase.from("payroll_constants").select("id", { count: "exact", head: true }),
        supabase.from("public_holidays").select("id", { count: "exact", head: true }),
        supabase.from("sites").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("shift_types").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("profiles").select("id, role, assigned_site_ids"),
        supabase.from("schedule_assignments").select("id", { count: "exact", head: true }),
        supabase.from("shift_logs").select("id", { count: "exact", head: true }),
        supabase.from("shift_logs").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("leave_policies").select("id", { count: "exact", head: true }),
        supabase.from("pay_periods").select("id, label, status, start_date, end_date").eq("status", "open").maybeSingle(),
        supabase.from("payroll_runs").select("id", { count: "exact", head: true }),
        supabase.from("disciplinary_actions").select("id", { count: "exact", head: true }),
      ]);

      const profileRows = profiles.data ?? [];
      const supervisorProfiles = profileRows.filter((p) => p.role === "security_supervisor");
      const supervisorsAssigned = supervisorProfiles.filter(
        (p) => (p.assigned_site_ids?.length ?? 0) > 0
      ).length;

      return {
        tenant: tenant.data,
        constants: constants.count ?? 0,
        publicHolidays: publicHolidays.count ?? 0,
        sites: sites.count ?? 0,
        shiftTypes: shiftTypes.count ?? 0,
        employees: employees.count ?? 0,
        teamCount: profileRows.length,
        supervisorCount: supervisorProfiles.length,
        supervisorsAssigned,
        assignments: assignments.count ?? 0,
        shiftLogsTotal: shiftLogsTotal.count ?? 0,
        shiftLogsApproved: shiftLogsApproved.count ?? 0,
        leavePolicies: leavePolicies.count ?? 0,
        openPeriod: openPeriod.data,
        payrollRuns: payrollRuns.count ?? 0,
        disciplinary: disciplinary.count ?? 0,
      };
    },
  });

  const adminHint = isAdminOrCeo ? undefined : "Admin-only. Ask your admin to confirm.";

  const steps: Step[] = [
    {
      n: 1, key: "company", icon: Building2,
      title: "Set up company profile",
      blurb: "Legal name, VAT number, address, logo and banking details.",
      why: "Invoices, payslips and the ABSA bank export render blank without this.",
      to: "/admin/settings", cta: "Open Admin Settings",
      done: Boolean(data?.tenant?.legal_name?.trim() && data?.tenant?.bank_account_number?.trim()),
      hint: adminHint,
    },
    {
      n: 2, key: "constants", icon: Settings,
      title: "Verify payroll constants",
      blurb: "Min wage, SSC rate/cap, PAYE threshold, Sunday & public-holiday multipliers, monthly hour-cap policy.",
      why: "Every paycheck math call reads these live. Missing keys silently fall back to hardcoded defaults.",
      to: "/admin/settings", cta: "Open Admin Settings",
      done: (data?.constants ?? 0) >= 10,
      count: data?.constants,
      hint: adminHint,
    },
    {
      n: 3, key: "public-holidays", icon: Flag,
      title: "Load public holidays",
      blurb: "Add this pay year's public holiday dates.",
      why: "Shifts worked on an unlisted holiday get paid at the normal rate, not the 2× holiday rate.",
      to: "/schedule", cta: "Open schedule",
      done: (data?.publicHolidays ?? 0) > 0,
      count: data?.publicHolidays,
      hint: (data?.publicHolidays ?? 0) > 0
        ? undefined
        : "No in-app editor yet — ask an engineer to insert rows into public_holidays.",
    },
    {
      n: 4, key: "sites", icon: MapPin,
      title: "Add your sites",
      blurb: "Create each client site. Supervisors are scoped by site_id via RLS.",
      why: "Every shift, assignment, and incident must belong to a site.",
      to: "/sites", cta: "Manage sites",
      done: (data?.sites ?? 0) > 0,
      count: data?.sites,
    },
    {
      n: 5, key: "shift-types", icon: Layers,
      title: "Configure shift types",
      blurb: "Define Day/Night (or other) shift templates used by the roster.",
      why: "The schedule can't assign a guard to a shift that doesn't exist yet.",
      to: "/schedule", cta: "Open schedule",
      done: (data?.shiftTypes ?? 0) > 0,
      count: data?.shiftTypes,
      hint: (data?.shiftTypes ?? 0) > 0
        ? undefined
        : "No in-app editor yet — ask an engineer to seed Day/Night shift types.",
    },
    {
      n: 6, key: "employees", icon: Users,
      title: "Import / create employees",
      blurb: "Bulk import via CSV/Excel or add manually. Set hourly rate, bank, home site.",
      why: "Employees are the atomic unit for scheduling and payroll.",
      to: "/employees", cta: "Go to employees",
      done: (data?.employees ?? 0) > 0,
      count: data?.employees,
    },
    {
      n: 7, key: "team", icon: UserPlus,
      title: "Invite your team",
      blurb: "Self-signup is disabled — invite payroll, accountant, and security_supervisor accounts here.",
      why: "Without dedicated accounts, only the original admin can touch payroll, attendance approvals, or musters.",
      to: "/admin/users", cta: "Open System Users",
      done: (data?.teamCount ?? 0) > 1,
      count: data?.teamCount,
      hint: adminHint,
    },
    {
      n: 8, key: "supervisors", icon: UserCog,
      title: "Assign supervisors to sites",
      blurb: "Field supervisors only see and can act on the sites assigned to them.",
      why: "A security_supervisor account with no site assignment can't record a muster anywhere.",
      to: "/supervisors", cta: "Open supervisors",
      done: (data?.supervisorCount ?? 0) === 0 || (data?.supervisorsAssigned ?? 0) > 0,
      count: data?.supervisorsAssigned,
      hint: (data?.supervisorCount ?? 0) === 0 ? "Optional — only if you use security_supervisor accounts." : undefined,
    },
    {
      n: 9, key: "schedule", icon: CalendarDays,
      title: "Build the roster",
      blurb: "Assign guards to shifts per site. Blocks >60h/week, unsafe Night→Day transitions, and skipped weekly rest.",
      why: "The schedule is the plan that daily attendance confirms or corrects.",
      to: "/schedule", cta: "Open schedule",
      done: (data?.assignments ?? 0) > 0,
      count: data?.assignments,
    },
    {
      n: 10, key: "attendance", icon: ClipboardList,
      title: "Run daily muster",
      blurb: "Confirm present / absent / replacements. security_supervisor musters save as \"submitted\", not \"approved\".",
      why: "calculateNetPay() only sees shift_logs with status = approved.",
      to: "/attendance", cta: "Open daily muster",
      done: (data?.shiftLogsTotal ?? 0) > 0,
      count: data?.shiftLogsTotal,
    },
    {
      n: 11, key: "approvals", icon: ClipboardCheck,
      title: "Approve attendance",
      blurb: "Payroll/admin reviews and approves supervisor-submitted musters.",
      why: "Submitted-but-unapproved shift logs are invisible to payroll — this is the step that unblocks them.",
      to: "/approvals", cta: "Open approvals",
      done: (data?.shiftLogsApproved ?? 0) > 0,
      count: data?.shiftLogsApproved,
    },
    {
      n: 12, key: "leave", icon: CalendarOff,
      title: "Set up leave policies",
      blurb: "Annual, sick, maternity and compassionate leave rules, accrual, and two-person approval.",
      why: "Leave requests and payroll deductions have nothing to validate against until policies exist.",
      to: "/leave", cta: "Open leave",
      done: (data?.leavePolicies ?? 0) > 0,
      count: data?.leavePolicies,
      hint: adminHint,
    },
    {
      n: 13, key: "disciplinary", icon: ShieldAlert,
      title: "Log disciplinary actions & exits (optional)",
      blurb: "Record, verify, then confirm offences (S.12(5) gate for fines). Only confirmed actions affect payroll.",
      why: "Unpaid suspensions auto-zero hours; fines flow to deductions — but only once confirmed.",
      to: "/disciplinary", cta: "Open disciplinary",
      done: true, // optional step
      count: data?.disciplinary,
      hint: "Optional — only if you have offences or an exit (dismissal/resignation) this period.",
    },
    {
      n: 14, key: "payroll", icon: Calculator,
      title: "Process payroll & lock period",
      blurb: "Server-side run-payroll generates gross-to-net (incl. Sunday call-in vs. rostered rate split), export ABSA CSV + PDF payslips, then Finalize to lock.",
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
          The payroll workflow, end-to-end
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Work through these {steps.length} steps in order. Each step unlocks the data the next one needs.
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
          <CardTitle className="font-display text-base">Also available</CardTitle>
          <CardDescription>Beyond the core payroll workflow above — visibility depends on your role.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {EXTRA_MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <Link
                key={m.to}
                to={m.to}
                className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm hover:border-primary/40 transition-colors"
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium text-foreground">{m.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{m.blurb}</span>
                  {m.note && <span className="block text-xs text-muted-foreground/70 mt-0.5">{m.note}</span>}
                </span>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="font-display text-base">Test checklist (what I'd try first)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. <strong className="text-foreground">Admin Settings</strong> → fill in company/banking details, confirm payroll constants match 2026 rates.</p>
          <p>2. <strong className="text-foreground">Sites</strong> → create 2 sites (e.g. "Main Office", "Downtown Branch").</p>
          <p>3. <strong className="text-foreground">Employees</strong> → either use the seeded demo guards, or test the CSV importer with a sample Excel file.</p>
          <p>4. <strong className="text-foreground">Schedule</strong> → drop 12h Day + 12h Night onto a guard for 7 days straight and watch the roster-integrity rules fire.</p>
          <p>5. <strong className="text-foreground">Attendance</strong> → mark one guard absent today and use "Replace" to see relief-guard suggestions.</p>
          <p>6. <strong className="text-foreground">Approvals</strong> → as a supervisor, submit a muster, then approve it as admin/payroll and watch it feed payroll.</p>
          <p>7. <strong className="text-foreground">Leave</strong> → submit a leave request and confirm two-person approval and accrual.</p>
          <p>8. <strong className="text-foreground">Disciplinary</strong> → try to save a fine without a Collective Agreement ref → should be blocked; confirm a suspension and check it zeroes hours.</p>
          <p>9. <strong className="text-foreground">Payroll</strong> → generate the run, download one PDF payslip, download bank CSV, then Finalize → lock.</p>
        </CardContent>
      </Card>
    </div>
  );
}
