import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, Loader2, ShieldCheck, FileText, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/admin/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Admin settings — Demo Payroll System" }] }),
});

type Constant = { key: string; value: number; description: string | null };

function SettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, number>>({});

  if (profile?.role !== "admin" && profile?.is_ceo_executive !== true) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">Admin access required</p>
            <Button asChild className="mt-4"><Link to="/dashboard">Back to dashboard</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: constants, isLoading } = useQuery({
    queryKey: ["payroll-constants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_constants")
        .select("key, value, description")
        .order("key");
      if (error) throw error;
      return data as Constant[];
    },
  });

  const update = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(edits);
      for (const [key, value] of updates) {
        const { error } = await supabase.from("payroll_constants").update({ value }).eq("key", key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Constants updated");
      setEdits({});
      void queryClient.invalidateQueries({ queryKey: ["payroll-constants"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
          <Settings className="h-7 w-7 text-muted-foreground" /> Admin settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Statutory rates and operational defaults. Update these when the Finance Minister announces budget changes.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Payroll constants</CardTitle>
          <CardDescription>
            Used by the gross-to-net calculator. All amounts in NAD; rates as decimals (0.009 = 0.9%).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : (
            constants?.map((c) => {
              const current = edits[c.key] ?? c.value;
              const dirty = edits[c.key] != null && edits[c.key] !== Number(c.value);
              return (
                <div key={c.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start py-3 border-b last:border-0">
                  <div>
                    <Label className="font-mono text-xs">{c.key}</Label>
                    {c.description && <p className="text-xs text-muted-foreground mt-1">{c.description}</p>}
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <Input
                      type="number"
                      step="any"
                      value={current}
                      onChange={(e) => setEdits({ ...edits, [c.key]: Number(e.target.value) })}
                      className="font-mono max-w-xs"
                    />
                    {dirty && <span className="text-xs text-warning">modified</span>}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <CompanyBillingCard />

      <ContractTemplatesCard />

      <div className="flex justify-end">
        <Button
          onClick={() => update.mutate()}
          disabled={Object.keys(edits).length === 0 || update.isPending}
        >
          {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

// ─── Company & billing profile ────────────────────────────────────────────────

type BillingProfile = {
  id: string;
  legal_name: string | null;
  registered_address: string | null;
  vat_number: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_website: string | null;
  logo_url: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch_name: string | null;
  bank_branch_code: string | null;
  default_tax_rate: number;
  invoice_due_days: number;
  invoice_penalty_note: string | null;
  invoice_footer_note: string | null;
  night_premium_enabled: boolean;
};

const BLANK_BILLING: Omit<BillingProfile, "id"> = {
  legal_name: "", registered_address: "", vat_number: "", company_phone: "",
  company_email: "", company_website: "", logo_url: "", bank_name: "",
  bank_account_name: "", bank_account_number: "", bank_branch_name: "",
  bank_branch_code: "", default_tax_rate: 0.15, invoice_due_days: 7,
  invoice_penalty_note: "", invoice_footer_note: "", night_premium_enabled: true,
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CompanyBillingCard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Omit<BillingProfile, "id">>(BLANK_BILLING);
  const [id, setId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["company-billing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(`id, legal_name, registered_address, vat_number, company_phone, company_email,
                 company_website, logo_url, bank_name, bank_account_name, bank_account_number,
                 bank_branch_name, bank_branch_code, default_tax_rate, invoice_due_days,
                 invoice_penalty_note, invoice_footer_note, night_premium_enabled`)
        .limit(1).maybeSingle();
      if (error) throw error;
      return data as BillingProfile | null;
    },
  });

  useEffect(() => {
    if (!data || loaded) return;
    const { id: tid, ...rest } = data;
    setId(tid);
    setDraft({
      ...BLANK_BILLING,
      ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? (k === "default_tax_rate" ? 0.15 : k === "invoice_due_days" ? 7 : "")])),
    } as Omit<BillingProfile, "id">);
    setLoaded(true);
  }, [data, loaded]);

  const set = (patch: Partial<Omit<BillingProfile, "id">>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Tenant not loaded");
      const payload = {
        ...draft,
        legal_name: draft.legal_name?.trim() || null,
        registered_address: draft.registered_address?.trim() || null,
        vat_number: draft.vat_number?.trim() || null,
        company_phone: draft.company_phone?.trim() || null,
        company_email: draft.company_email?.trim() || null,
        company_website: draft.company_website?.trim() || null,
        logo_url: draft.logo_url?.trim() || null,
        bank_name: draft.bank_name?.trim() || null,
        bank_account_name: draft.bank_account_name?.trim() || null,
        bank_account_number: draft.bank_account_number?.trim() || null,
        bank_branch_name: draft.bank_branch_name?.trim() || null,
        bank_branch_code: draft.bank_branch_code?.trim() || null,
        invoice_penalty_note: draft.invoice_penalty_note?.trim() || null,
        invoice_footer_note: draft.invoice_footer_note?.trim() || null,
        default_tax_rate: Number(draft.default_tax_rate) || 0,
        invoice_due_days: Math.max(0, Math.round(Number(draft.invoice_due_days) || 0)),
        night_premium_enabled: Boolean(draft.night_premium_enabled),
      };
      const { error } = await supabase.from("tenants").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Company profile saved");
      void qc.invalidateQueries({ queryKey: ["company-billing"] });
      void qc.invalidateQueries({ queryKey: ["tenant-billing-meta"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Company &amp; billing profile</CardTitle>
        <CardDescription>
          Appears on every invoice and bill PDF. Nothing here is hardcoded — each tenant sets their own identity, bank details and tax defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Legal / trading name">
                <Input value={draft.legal_name ?? ""} onChange={(e) => set({ legal_name: e.target.value })} placeholder="Acme Security (Pty) Ltd" />
              </Field>
              <Field label="VAT registration number">
                <Input value={draft.vat_number ?? ""} onChange={(e) => set({ vat_number: e.target.value })} placeholder="1234567-01-2" />
              </Field>
              <Field label="Registered address" hint="One line per row — shown under the company name.">
                <Textarea value={draft.registered_address ?? ""} onChange={(e) => set({ registered_address: e.target.value })} rows={3} />
              </Field>
              <div className="space-y-4">
                <Field label="Phone"><Input value={draft.company_phone ?? ""} onChange={(e) => set({ company_phone: e.target.value })} /></Field>
                <Field label="Email"><Input value={draft.company_email ?? ""} onChange={(e) => set({ company_email: e.target.value })} /></Field>
              </div>
              <Field label="Website"><Input value={draft.company_website ?? ""} onChange={(e) => set({ company_website: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Logo URL" hint="Public PNG/JPG. Optional — falls back to the company name.">
                <Input value={draft.logo_url ?? ""} onChange={(e) => set({ logo_url: e.target.value })} placeholder="https://…/logo.png" />
              </Field>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Banking details</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Bank name"><Input value={draft.bank_name ?? ""} onChange={(e) => set({ bank_name: e.target.value })} /></Field>
                <Field label="Account name"><Input value={draft.bank_account_name ?? ""} onChange={(e) => set({ bank_account_name: e.target.value })} /></Field>
                <Field label="Account number"><Input value={draft.bank_account_number ?? ""} onChange={(e) => set({ bank_account_number: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Branch name"><Input value={draft.bank_branch_name ?? ""} onChange={(e) => set({ bank_branch_name: e.target.value })} /></Field>
                  <Field label="Branch code"><Input value={draft.bank_branch_code ?? ""} onChange={(e) => set({ bank_branch_code: e.target.value })} /></Field>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Invoice defaults</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Default VAT rate (%)" hint="Applied to new line items.">
                  <Input type="number" step="any" value={Math.round((Number(draft.default_tax_rate) || 0) * 10000) / 100}
                    onChange={(e) => set({ default_tax_rate: (Number(e.target.value) || 0) / 100 })} />
                </Field>
                <Field label="Payment terms (days)" hint="Default gap between invoice date and due date.">
                  <Input type="number" value={draft.invoice_due_days}
                    onChange={(e) => set({ invoice_due_days: Number(e.target.value) })} />
                </Field>
                <Field label="Penalty note" hint="Shown near the payment communication.">
                  <Textarea value={draft.invoice_penalty_note ?? ""} onChange={(e) => set({ invoice_penalty_note: e.target.value })} rows={2} />
                </Field>
                <Field label="Footer note" hint="Shown centered at the bottom of the page.">
                  <Textarea value={draft.invoice_footer_note ?? ""} onChange={(e) => set({ invoice_footer_note: e.target.value })} rows={2} />
                </Field>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Payroll policy</p>
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Pay night-shift premium (+6%)</div>
                  <p className="text-xs text-muted-foreground">
                    When on, hours worked between 20h00 and 07h00 earn an extra 6% (Labour Act s.19).
                    Turn off to stop paying the night premium — night hours are still recorded on payslips, just not paid.
                  </p>
                </div>
                <Switch
                  checked={draft.night_premium_enabled}
                  onCheckedChange={(v) => set({ night_premium_enabled: v })}
                />
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !id}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save company profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type TemplateRow = {
  id: string;
  contract_template_officer: string | null;
  contract_template_driver: string | null;
  contract_template_management: string | null;
};

const KIND_LABELS = {
  officer: "Security Officer",
  driver: "Driver",
  management: "Management",
} as const;
type Kind = keyof typeof KIND_LABELS;

const TOKEN_HINT =
  "Available tokens: {{company_name}}, {{employee_full_name}}, {{employee_code}}, {{national_id}}, {{position}}, {{compensation_line}}, {{hourly_rate}}, {{monthly_salary}}, {{transport_allowance}}, {{home_site}}, {{start_date}}, {{today}}";

function ContractTemplatesCard() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Kind>("officer");
  const [draft, setDraft] = useState<Record<Kind, string>>({ officer: "", driver: "", management: "" });
  const [loaded, setLoaded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["contract-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, contract_template_officer, contract_template_driver, contract_template_management")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as TemplateRow | null;
    },
  });

  useEffect(() => {
    if (!data || loaded) return;
    setDraft({
      officer: data.contract_template_officer ?? "",
      driver: data.contract_template_driver ?? "",
      management: data.contract_template_management ?? "",
    });
    setLoaded(true);
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      if (!data?.id) throw new Error("Tenant not loaded");
      const { error } = await supabase
        .from("tenants")
        .update({
          contract_template_officer: draft.officer.trim() || null,
          contract_template_driver: draft.driver.trim() || null,
          contract_template_management: draft.management.trim() || null,
        })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contract templates saved");
      void qc.invalidateQueries({ queryKey: ["contract-templates"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" /> Contract templates
        </CardTitle>
        <CardDescription>
          One template per employee category. The PDF generated for each guard merges these tokens with their record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
            <TabsList>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <TabsTrigger key={k} value={k}>{KIND_LABELS[k]}</TabsTrigger>
              ))}
            </TabsList>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
              <TabsContent key={k} value={k} className="space-y-2">
                <Textarea
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  className="min-h-[320px] font-mono text-xs"
                  placeholder={`Enter the ${KIND_LABELS[k].toLowerCase()} contract body…`}
                />
                <p className="text-[11px] text-muted-foreground">{TOKEN_HINT}</p>
              </TabsContent>
            ))}
          </Tabs>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !data}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save templates
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
