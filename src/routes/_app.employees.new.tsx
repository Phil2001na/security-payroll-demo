import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/employees/new")({
  component: NewEmployeePage,
  head: () => ({ meta: [{ title: "New employee — Dog Force Payroll" }] }),
});

const positions = [
  { value: "security_officer", label: "Security officer", category: "officer" as const },
  { value: "driver", label: "Driver", category: "officer" as const },
  { value: "supervisor", label: "Supervisor", category: "officer" as const },
  { value: "site_manager", label: "Site manager", category: "management" as const },
  { value: "operations_manager", label: "Operations manager", category: "management" as const },
  { value: "admin", label: "Admin", category: "management" as const },
  { value: "other", label: "Other", category: "management" as const },
];

const employeeSchema = z.object({
  employee_code: z.string().trim().min(1, "Required").max(20),
  surname: z.string().trim().min(1, "Required").max(80),
  first_names: z.string().trim().min(1, "Required").max(120),
  national_id: z.string().trim().max(40).optional().or(z.literal("")),
  position: z.enum(["security_officer", "driver", "supervisor", "site_manager", "operations_manager", "admin", "other"]),
  hourly_rate: z.coerce.number().min(0),
  monthly_salary: z.coerce.number().min(0),
  transport_allowance: z.coerce.number().min(0),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  home_site_id: z.string().uuid().optional().or(z.literal("")),
  bank_name: z.string().max(80).optional().or(z.literal("")),
  bank_account_number: z.string().max(40).optional().or(z.literal("")),
  union_member: z.boolean(),
  ordinarily_works_sundays: z.boolean(),
  preferred_shift: z.enum(["day", "night", "both"]),
});

function NewEmployeePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const canCreateManagement = profile?.role === "admin" || profile?.role === "operations";
  const [form, setForm] = useState({
    employee_code: "", surname: "", first_names: "", national_id: "",
    position: "security_officer" as typeof positions[number]["value"],
    hourly_rate: 16, monthly_salary: 0, transport_allowance: 350,
    phone: "", email: "", start_date: "", home_site_id: "",
    bank_name: "", bank_account_number: "",
    union_member: false, ordinarily_works_sundays: false,
    preferred_shift: "both" as "day" | "night" | "both",
  });

  const positionMeta = positions.find((p) => p.value === form.position)!;
  const isManagement = positionMeta.category === "management";

  const { data: sites } = useQuery({
    queryKey: ["sites-list", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenant_id) return;
    const meta = positions.find((p) => p.value === form.position)!;
    if (meta.category === "management" && !canCreateManagement) {
      toast.error("Only Admin or Operations Manager can create management staff.");
      return;
    }
    if (meta.category === "officer" && form.hourly_rate < 16) {
      toast.error("Officers must be paid at least N$16/hr (security minimum wage).");
      return;
    }
    if (meta.category === "management" && form.monthly_salary <= 0) {
      toast.error("Management staff need a monthly salary > 0.");
      return;
    }
    const parsed = employeeSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation error");
      return;
    }
    setSubmitting(true);
    try {
      const v = parsed.data;
      const category = meta.category;
      const { data, error } = await supabase.from("employees").insert({
        tenant_id: profile.tenant_id,
        employee_code: v.employee_code,
        surname: v.surname,
        first_names: v.first_names,
        national_id: v.national_id || null,
        position: v.position,
        category,
        hourly_rate: category === "officer" ? v.hourly_rate : 0,
        monthly_salary: category === "management" ? v.monthly_salary : 0,
        transport_allowance: v.transport_allowance,
        phone: v.phone || null,
        email: v.email || null,
        start_date: v.start_date || null,
        home_site_id: category === "officer" ? (v.home_site_id || null) : null,
        bank_name: v.bank_name || null,
        bank_account_number: v.bank_account_number || null,
        union_member: v.union_member,
        ordinarily_works_sundays: v.ordinarily_works_sundays,
        preferred_shift: v.preferred_shift,
      }).select("id").single();
      if (error) throw error;
      toast.success("Employee created");
      void navigate({ to: "/employees/$employeeId", params: { employeeId: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link to="/employees"><ArrowLeft className="mr-1 h-4 w-4" /> Back to employees</Link>
        </Button>
        <h1 className="font-display text-3xl font-bold tracking-tight mt-3">Add employee</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new guard, supervisor, or staff member. The minimum security guard rate is N$16/hr per the 2026 sectoral determination.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Employee code" required>
              <Input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} required />
            </Field>
            <Field label="National ID">
              <Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} />
            </Field>
            <Field label="Surname" required>
              <Input value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} required />
            </Field>
            <Field label="First names" required>
              <Input value={form.first_names} onChange={(e) => setForm({ ...form, first_names: e.target.value })} required />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Role & site</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Position" required>
              <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v as typeof form.position })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {positions.map((p) => (
                    <SelectItem
                      key={p.value}
                      value={p.value}
                      disabled={p.category === "management" && !canCreateManagement}
                    >
                      {p.label}{p.category === "management" ? " — fixed salary" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isManagement && !canCreateManagement && (
                <p className="text-xs text-destructive mt-1">Only Admin or Operations Manager can add management staff.</p>
              )}
            </Field>
            <Field label="Home site">
              <Select
                value={form.home_site_id || "none"}
                onValueChange={(v) => setForm({ ...form, home_site_id: v === "none" ? "" : v })}
                disabled={isManagement}
              >
                <SelectTrigger><SelectValue placeholder={isManagement ? "N/A for management" : "Unassigned"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {sites?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="Preferred shift">
              <Select
                value={form.preferred_shift}
                onValueChange={(v) => setForm({ ...form, preferred_shift: v as "day" | "night" | "both" })}
                disabled={isManagement}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Day or Night</SelectItem>
                  <SelectItem value="day">Day only</SelectItem>
                  <SelectItem value="night">Night only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Compensation</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isManagement ? (
              <Field label="Monthly salary (NAD)" required>
                <Input type="number" step="0.01" min="0" value={form.monthly_salary}
                  onChange={(e) => setForm({ ...form, monthly_salary: Number(e.target.value) })} required />
                <p className="text-xs text-muted-foreground mt-1">Paid flat each pay period regardless of hours worked. PAYE + SSC still apply.</p>
              </Field>
            ) : (
              <Field label="Hourly rate (NAD)" required>
                <Input type="number" step="0.01" min="16" value={form.hourly_rate}
                  onChange={(e) => setForm({ ...form, hourly_rate: Number(e.target.value) })} required />
                <p className="text-xs text-muted-foreground mt-1">Min N$16/hr per 2026 sectoral determination. Guards & drivers paid the same rate.</p>
              </Field>
            )}
            <Field label="Transport allowance (NAD/month)">
              <Input type="number" step="0.01" min="0" value={form.transport_allowance}
                onChange={(e) => setForm({ ...form, transport_allowance: Number(e.target.value) })} />
            </Field>
            <Field label="Bank name">
              <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </Field>
            <Field label="Bank account">
              <Input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Agreements</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Union member"
              description="Member of a recognised union (affects deductions)."
              checked={form.union_member}
              onChange={(v) => setForm({ ...form, union_member: v })}
            />
            <ToggleRow
              label="Ordinarily works Sundays"
              description="Sunday hours paid at 1.5× (with written agreement). Otherwise 2× per Labour Act default."
              checked={form.ordinarily_works_sundays}
              onChange={(v) => setForm({ ...form, ordinarily_works_sundays: v })}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" asChild><Link to="/employees">Cancel</Link></Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Create employee
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
