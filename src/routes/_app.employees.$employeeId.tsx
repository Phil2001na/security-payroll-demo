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
import { PackageCheck, Undo2 } from "lucide-react";

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

  const updateSundays = useMutation({
    mutationFn: async (ordinarilyWorksSundays: boolean) => {
      const { error } = await supabase
        .from("employees")
        .update({ ordinarily_works_sundays: ordinarilyWorksSundays })
        .eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sunday work preference updated");
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update preference"),
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
            <div className="flex items-center justify-between gap-4 py-1">
              <span className="text-muted-foreground">Ordinarily works Sundays</span>
              <Select
                value={data.ordinarily_works_sundays ? "yes" : "no"}
                onValueChange={(v) => updateSundays.mutate(v === "yes")}
                disabled={updateSundays.isPending}
              >
                <SelectTrigger className="h-8 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes (1.5×)</SelectItem>
                  <SelectItem value="no">No (2× default)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              <Row label="Accrual rate" value="1 day / 12 worked" mono />
              <Row label="Sick days" value={`${Number(leave?.sick_days ?? 0).toFixed(2)}`} mono />
              <Row
                label="Compassionate"
                value={`${Number(leave?.compassionate_days ?? 0).toFixed(2)}`}
                mono
              />
              <p className="text-xs text-muted-foreground pt-1">
                Earned from days actually worked — 1 leave day per 12 worked days of approved
                attendance, credited when each payroll period is finalized.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <EquipmentCard employeeId={employeeId} />
    </div>
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
