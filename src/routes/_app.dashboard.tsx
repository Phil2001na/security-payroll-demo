import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, MapPin, Calculator, ShieldAlert, AlertTriangle, Sparkles, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNAD } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Dog Force Payroll" }] }),
});

function DashboardPage() {
  const { profile } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const [employees, sites, openDisciplinary, openPeriod] = await Promise.all([
        supabase.from("employees").select("id, status, hourly_rate", { count: "exact" }).eq("status", "active"),
        supabase.from("sites").select("id", { count: "exact" }).eq("active", true),
        supabase.from("disciplinary_actions").select("id", { count: "exact" }).is("resolved_at", null),
        supabase.from("pay_periods").select("id, label, status, start_date, end_date").eq("status", "open").maybeSingle(),
      ]);

      const totalActive = employees.count ?? 0;
      const avgRate = employees.data && employees.data.length > 0
        ? employees.data.reduce((s, e) => s + Number(e.hourly_rate ?? 0), 0) / employees.data.length
        : 0;

      return {
        activeEmployees: totalActive,
        avgRate,
        activeSites: sites.count ?? 0,
        openDisciplinary: openDisciplinary.count ?? 0,
        openPeriod: openPeriod.data,
      };
    },
  });

  const cards = [
    { label: "Active employees", value: stats?.activeEmployees ?? 0, icon: Users, accent: "text-info" },
    { label: "Active sites", value: stats?.activeSites ?? 0, icon: MapPin, accent: "text-success" },
    { label: "Open disciplinary", value: stats?.openDisciplinary ?? 0, icon: ShieldAlert, accent: "text-warning" },
    { label: "Avg hourly rate", value: formatNAD(stats?.avgRate ?? 0), icon: Calculator, accent: "text-primary" },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="capitalize font-medium text-foreground">{profile?.role}</span>
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Welcome back, {profile?.full_name?.split(" ")[0] ?? "Operator"}
        </h1>
        <p className="text-muted-foreground">
          Here's a snapshot of operations across Dog Force Security Services.
        </p>
      </header>

      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">New here? Start with the guided workflow</h2>
              <p className="text-sm text-muted-foreground">
                Seven ordered steps from constants → sites → employees → schedule → attendance → payroll.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/wizard">
              Open wizard <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="relative overflow-hidden">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.accent}`} />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="font-mono text-2xl font-bold">{c.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display">Current pay period</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : stats?.openPeriod ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="default">Open</Badge>
                  <span className="font-display text-lg font-semibold">{stats.openPeriod.label}</span>
                </div>
                <p className="text-sm text-muted-foreground font-mono">
                  {stats.openPeriod.start_date} → {stats.openPeriod.end_date}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/5 p-4">
                <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                <div>
                  <div className="font-medium">No open pay period</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Open a new pay period from the Payroll module to start logging shifts.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Min wage (security)</span>
              <span className="font-mono font-semibold">N$16.00/hr</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">SSC employee</span>
              <span className="font-mono font-semibold">0.9% (max N$99)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">PAYE threshold</span>
              <span className="font-mono font-semibold">N$100,000</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">OT cap (s.17(3))</span>
              <span className="font-mono font-semibold">70 hrs/wk</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
