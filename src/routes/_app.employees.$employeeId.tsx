import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, FileSignature, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNAD, formatDate, initials } from "@/lib/format";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();

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
        <Button asChild className="mt-4"><Link to="/employees">Back to employees</Link></Button>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link to="/employees"><ArrowLeft className="mr-1 h-4 w-4" /> Back to employees</Link>
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
            <Badge variant="outline" className="capitalize">{data.status}</Badge>
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
          <div className="text-sm text-muted-foreground capitalize">{data.position.replace(/_/g, " ")}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Compensation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Hourly rate" value={formatNAD(data.hourly_rate)} mono />
            <Row label="Transport allowance" value={formatNAD(data.transport_allowance)} mono />
            <Row label="Bank" value={data.bank_name ?? "—"} />
            <Row label="Account" value={data.bank_account_number ?? "—"} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Contact & site</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Phone" value={data.phone ?? "—"} mono />
            <Row label="Email" value={data.email ?? "—"} />
            <Row label="National ID" value={data.national_id ?? "—"} mono />
            <Row label="Home site" value={(data.sites as { name?: string } | null)?.name ?? "—"} />
            <Row label="Start date" value={formatDate(data.start_date)} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Agreements & preferences</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Union member" value={data.union_member ? "Yes" : "No"} />
            <Row label="Ordinarily works Sundays" value={data.ordinarily_works_sundays ? "Yes (1.5×)" : "No (2× default)"} />
            <Row label="Preferred shift" value={
              data.preferred_shift === "day" ? "Day only" :
              data.preferred_shift === "night" ? "Night only" : "Day or Night"
            } />
          </CardContent>
        </Card>
      </div>
    </div>
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
