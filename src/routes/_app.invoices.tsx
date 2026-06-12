import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, Plus, Download, ChevronDown, ChevronRight, Loader2, Paperclip,
  Send, CheckCircle, XCircle, AlertCircle, Trash2, FilePlus2, Building2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatNAD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Invoices — Demo Payroll System" }] }),
});

// ─── Types ──────────────────────────────────────────────────────────────────

type InvoiceStatus = "draft" | "issued" | "paid" | "void";
type InvoiceType = "AR" | "AP";

type Invoice = {
  id: string;
  invoice_number: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  total: number;
  tax: number;
  due_date: string | null;
  invoice_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  notes: string | null;
  receipt_url: string | null;
  created_at: string;
  pay_period_id: string | null;
  clients: { name: string } | null;
  sites: { name: string } | null;
  vendors: { name: string } | null;
  pay_periods: { label: string } | null;
};

type InvoiceItem = { id: string; description: string; quantity: number; unit_price: number; tax_rate: number };
type PayPeriod = { id: string; label: string; start_date: string; end_date: string; status: string };
type ClientOption = { id: string; name: string; payment_terms_days: number | null };
type SiteOption = { id: string; name: string; client_id: string | null; billing_rate: number | null };
type Vendor = { id: string; name: string };
type ServiceItem = { id: string; name: string; description: string | null; unit: string; default_rate: number };
type TenantBilling = { id: string; default_tax_rate: number; invoice_due_days: number };

// Typical things a security business spends money on — prefills the bill line.
const EXPENSE_CATEGORIES = [
  "Fuel", "Vehicle maintenance", "Uniforms & equipment", "Firearms & ammunition licensing",
  "Radio & communications", "Office rent", "Utilities", "Insurance",
  "Bank charges", "Stationery & printing", "Training & certification", "Other",
];

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:  { label: "Draft",  className: "bg-muted text-muted-foreground border-border" },
  issued: { label: "Issued", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  paid:   { label: "Paid",   className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" },
  void:   { label: "Void",   className: "bg-destructive/10 text-destructive border-destructive/20" },
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

// ─── Manual invoice / bill builder ────────────────────────────────────────────

type DraftItem = {
  service_item_id: string;   // "" = custom line
  description: string;
  quantity: string;
  unit_price: string;
  tax_pct: string;
};

function emptyItem(taxPct: number): DraftItem {
  return { service_item_id: "", description: "", quantity: "1", unit_price: "", tax_pct: String(taxPct) };
}

function NewInvoiceDialog({
  open, onOpenChange, type, tenant,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: InvoiceType;
  tenant: TenantBilling | null;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const defaultTaxPct = tenant ? Math.round(tenant.default_tax_rate * 100) : 15;
  const dueDays = tenant?.invoice_due_days ?? 7;

  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorNumber, setVendorNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDays(todayISO(), dueDays));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem(defaultTaxPct)]);
  const [newVendorName, setNewVendorName] = useState("");
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const isAR = type === "AR";

  const { data: clients = [] } = useQuery<ClientOption[]>({
    queryKey: ["clients-for-invoice"],
    enabled: open && isAR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("id, name, payment_terms_days")
        .eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ClientOption[];
    },
  });

  const { data: sites = [] } = useQuery<SiteOption[]>({
    queryKey: ["sites-for-invoice"],
    enabled: open && isAR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites").select("id, name, client_id, billing_rate")
        .eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as SiteOption[];
    },
  });

  const { data: serviceItems = [] } = useQuery<ServiceItem[]>({
    queryKey: ["service-items"],
    enabled: open && isAR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_items").select("id, name, description, unit, default_rate")
        .eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ServiceItem[];
    },
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["vendors-for-invoice"],
    enabled: open && !isAR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as Vendor[];
    },
  });

  const clientSites = useMemo(
    () => sites.filter((s) => s.client_id === clientId),
    [sites, clientId],
  );

  // Due date follows the client's payment terms (Zoho-style terms behaviour)
  useEffect(() => {
    if (!isAR) return;
    const client = clients.find((c) => c.id === clientId);
    const days = client?.payment_terms_days ?? dueDays;
    setDueDate(addDays(invoiceDate, days));
  }, [clientId, invoiceDate, clients, dueDays, isAR]);

  const reset = () => {
    setClientId(""); setSiteId(""); setVendorId(""); setVendorNumber("");
    setInvoiceDate(todayISO()); setDueDate(addDays(todayISO(), dueDays)); setNotes("");
    setItems([emptyItem(defaultTaxPct)]);
    setNewVendorName(""); setShowNewVendor(false); setReceiptFile(null);
  };

  const updateItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem(defaultTaxPct)]);
  const removeItem = (i: number) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const pickServiceItem = (i: number, id: string) => {
    if (id === "custom") { updateItem(i, { service_item_id: "" }); return; }
    const svc = serviceItems.find((s) => s.id === id);
    if (!svc) return;
    updateItem(i, {
      service_item_id: id,
      description: svc.description ? `${svc.name} — ${svc.description}` : svc.name,
      unit_price: String(svc.default_rate),
    });
  };

  const pickCategory = (i: number, cat: string) =>
    updateItem(i, { description: cat === "Other" ? "" : cat });

  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const p = Number(it.unit_price) || 0;
      const r = (Number(it.tax_pct) || 0) / 100;
      sub += q * p;
      tax += q * p * r;
    }
    return { sub, tax, total: sub + tax };
  }, [items]);

  const createVendor = useMutation({
    mutationFn: async (name: string) => {
      if (!profile?.tenant_id) throw new Error("Tenant not resolved");
      const { data, error } = await supabase
        .from("vendors").insert({ tenant_id: profile.tenant_id, name }).select("id, name").single();
      if (error) throw error;
      return data as Vendor;
    },
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ["vendors-for-invoice"] });
      setVendorId(v.id); setShowNewVendor(false); setNewVendorName("");
      toast.success(`Vendor "${v.name}" added.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add vendor"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const cleanItems = items
        .map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          tax_rate: (Number(it.tax_pct) || 0) / 100,
        }))
        .filter((it) => it.description && it.quantity > 0 && it.unit_price >= 0);
      if (cleanItems.length === 0) throw new Error("Add at least one line item.");
      if (isAR && !clientId) throw new Error("Select a client.");
      if (!isAR && !vendorId) throw new Error("Select a vendor.");
      if (!profile?.tenant_id) throw new Error("Tenant not resolved");

      // Upload the receipt first so a failed upload doesn't leave a bill without it
      let receiptUrl: string | null = null;
      if (!isAR && receiptFile) {
        const path = `${profile.tenant_id}/${crypto.randomUUID()}-${receiptFile.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("receipts").upload(path, receiptFile);
        if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
        receiptUrl = path;
      }

      const insert = {
        tenant_id: profile.tenant_id,
        type,
        status: "draft" as const,
        total: 0,
        tax: 0,
        invoice_date: invoiceDate,
        due_date: dueDate,
        notes: notes.trim() || null,
        client_id: isAR ? clientId : null,
        site_id: isAR && siteId ? siteId : null,
        vendor_id: !isAR ? vendorId : null,
        invoice_number: !isAR && vendorNumber.trim() ? vendorNumber.trim() : null,
        receipt_url: receiptUrl,
      };

      const { data: inv, error: invErr } = await supabase
        .from("invoices").insert(insert).select("id").single();
      if (invErr || !inv) throw invErr ?? new Error("Invoice insert failed");

      const { error: itemErr } = await supabase
        .from("invoice_items")
        .insert(cleanItems.map((it) => ({ ...it, invoice_id: inv.id })));
      if (itemErr) {
        await supabase.from("invoices").delete().eq("id", inv.id);
        throw itemErr;
      }
      return inv.id as string;
    },
    onSuccess: () => {
      toast.success(`${isAR ? "Invoice" : "Bill"} created as draft.`);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New {isAR ? "invoice" : "supplier bill"}</DialogTitle>
          <DialogDescription>
            {isAR
              ? "Bill a client for services. Saved as a draft you can review and issue."
              : "Record money the business is spending. Attach the receipt or supplier invoice."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Party */}
          <div className="grid sm:grid-cols-2 gap-3">
            {isAR ? (
              <>
                <div className="space-y-1.5">
                  <Label>Client *</Label>
                  <Select value={clientId} onValueChange={(v) => { setClientId(v); setSiteId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Select a client…" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {clients.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No clients yet — <Link to="/clients" className="underline">register one first</Link>.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Site (optional)</Label>
                  <Select value={siteId} onValueChange={setSiteId} disabled={!clientId || clientSites.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder={!clientId ? "Pick a client first" : clientSites.length === 0 ? "Client has no sites" : "All sites / general"} />
                    </SelectTrigger>
                    <SelectContent>
                      {clientSites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Vendor *</Label>
                  {showNewVendor ? (
                    <div className="flex gap-2">
                      <Input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="New vendor name" />
                      <Button type="button" size="sm" disabled={!newVendorName.trim() || createVendor.isPending}
                        onClick={() => createVendor.mutate(newVendorName.trim())}>
                        {createVendor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select value={vendorId} onValueChange={setVendorId}>
                        <SelectTrigger><SelectValue placeholder="Select a vendor…" /></SelectTrigger>
                        <SelectContent>
                          {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" onClick={() => setShowNewVendor(true)} title="Add vendor">
                        <Building2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Supplier invoice #</Label>
                  <Input value={vendorNumber} onChange={(e) => setVendorNumber(e.target.value)} placeholder="As printed on their invoice" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>{isAR ? "Invoice date" : "Bill date"}</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {isAR && clientId && (
                <p className="text-xs text-muted-foreground">Auto-set from the client's payment terms — adjust if needed.</p>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add line
              </Button>
            </div>
            <div className="rounded-lg border divide-y">
              <div className="hidden sm:grid grid-cols-[170px_1fr_64px_92px_56px_92px_32px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>{isAR ? "Service" : "Category"}</span><span>Description</span>
                <span className="text-right">Qty</span><span className="text-right">Rate</span>
                <span className="text-right">Tax %</span><span className="text-right">Amount</span><span />
              </div>
              {items.map((it, i) => {
                const amt = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                return (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-[170px_1fr_64px_92px_56px_92px_32px] gap-2 px-3 py-2 items-center">
                    {isAR ? (
                      <Select value={it.service_item_id || "custom"} onValueChange={(v) => pickServiceItem(i, v)}>
                        <SelectTrigger className="text-xs col-span-2 sm:col-span-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom line…</SelectItem>
                          {serviceItems.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} <span className="text-xs text-muted-foreground">/{s.unit}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select value={EXPENSE_CATEGORIES.includes(it.description) ? it.description : "Other"}
                        onValueChange={(v) => pickCategory(i, v)}>
                        <SelectTrigger className="text-xs col-span-2 sm:col-span-1"><SelectValue placeholder="Category…" /></SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Input className="col-span-2 sm:col-span-1" value={it.description}
                      onChange={(e) => updateItem(i, { description: e.target.value, service_item_id: "" })}
                      placeholder={isAR ? "What is being billed" : "What was purchased"} />
                    <Input type="number" step="any" className="text-right font-mono" value={it.quantity}
                      onChange={(e) => updateItem(i, { quantity: e.target.value })} />
                    <Input type="number" step="any" className="text-right font-mono" value={it.unit_price}
                      onChange={(e) => updateItem(i, { unit_price: e.target.value })} placeholder="0.00" />
                    <Input type="number" step="any" className="text-right font-mono" value={it.tax_pct}
                      onChange={(e) => updateItem(i, { tax_pct: e.target.value })} />
                    <span className="text-right font-mono text-sm">{formatNAD(amt)}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                      onClick={() => removeItem(i)} disabled={items.length === 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-8 px-2 text-sm">
              <div className="space-y-1 text-right text-muted-foreground">
                <div>Untaxed</div><div>Tax</div><div className="font-semibold text-foreground">Total</div>
              </div>
              <div className="space-y-1 text-right font-mono w-32">
                <div>{formatNAD(totals.sub)}</div><div>{formatNAD(totals.tax)}</div>
                <div className="font-semibold">{formatNAD(totals.total)}</div>
              </div>
            </div>
          </div>

          {/* Receipt upload (AP only) */}
          {!isAR && (
            <div className="space-y-1.5">
              <Label>Receipt / supplier invoice (optional)</Label>
              <div className="flex items-center gap-3">
                <Input type="file" accept="image/*,.pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} className="max-w-sm" />
                {receiptFile && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> {receiptFile.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PDF or photo of the receipt — stored against this bill.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Internal note or payment reference" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Generate-from-payroll (AR) ───────────────────────────────────────────────

function GenerateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState("");

  const { data: periods = [] } = useQuery<PayPeriod[]>({
    queryKey: ["pay-periods-for-billing"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods").select("id, label, start_date, end_date, status")
        .in("status", ["locked", "paid"]).order("start_date", { ascending: false }).limit(12);
      if (error) throw error;
      return (data ?? []) as PayPeriod[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const period = periods.find((p) => p.id === selectedPeriod);
      if (!period) throw new Error("Select a pay period");
      const { data, error } = await supabase.functions.invoke("billing-engine", {
        body: { startDate: period.start_date, endDate: period.end_date, payPeriodId: selectedPeriod, issue: false },
      });
      if (error) throw error;
      return data as { invoices: unknown[] };
    },
    onSuccess: (data) => {
      const count = data.invoices?.length ?? 0;
      if (count === 0) toast.warning("No approved shifts with a billing rate found for this period.");
      else toast.success(`${count} draft invoice${count !== 1 ? "s" : ""} created.`);
      onOpenChange(false); setSelectedPeriod("");
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Generation failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate invoices from payroll period</DialogTitle>
          <DialogDescription>
            Aggregates approved shift hours per site into one draft invoice per client. Sites need a billing rate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pay period *</Label>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger><SelectValue placeholder="Select a period…" /></SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}<span className="ml-2 text-xs text-muted-foreground capitalize">({p.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-sm text-amber-800 flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Only approved shifts are billed. Sites with no billing rate are skipped. Created as <strong>drafts</strong>.</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || !selectedPeriod}>
            {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Generate drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Line items expansion ─────────────────────────────────────────────────────

function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const { data: items = [], isLoading } = useQuery<InvoiceItem[]>({
    queryKey: ["invoice-items", invoice.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items").select("id, description, quantity, unit_price, tax_rate")
        .eq("invoice_id", invoice.id).order("created_at");
      if (error) throw error;
      return (data ?? []) as InvoiceItem[];
    },
  });

  const openReceipt = async () => {
    if (!invoice.receipt_url) return;
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(invoice.receipt_url, 600);
    if (error || !data?.signedUrl) { toast.error("Could not open receipt"); return; }
    window.open(data.signedUrl, "_blank");
  };

  if (isLoading) return <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (items.length === 0) return <p className="py-4 text-sm text-muted-foreground">No line items found.</p>;

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const tax = items.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="rounded-lg border overflow-hidden text-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="py-2">Description</TableHead>
              <TableHead className="py-2 text-right w-20">Qty</TableHead>
              <TableHead className="py-2 text-right w-28">Unit price</TableHead>
              <TableHead className="py-2 text-right w-16">Tax</TableHead>
              <TableHead className="py-2 text-right w-28">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="py-2">{item.description}</TableCell>
                <TableCell className="py-2 text-right font-mono">{Number(item.quantity).toFixed(2)}</TableCell>
                <TableCell className="py-2 text-right font-mono">{formatNAD(item.unit_price)}</TableCell>
                <TableCell className="py-2 text-right font-mono">{Math.round((item.tax_rate ?? 0) * 100)}%</TableCell>
                <TableCell className="py-2 text-right font-mono">{formatNAD(item.quantity * item.unit_price)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t bg-muted/30 px-4 py-2.5 flex justify-end gap-8 text-sm">
          <div className="text-right text-muted-foreground space-y-0.5">
            <div>Untaxed</div><div>Tax</div><div className="font-medium text-foreground">Total</div>
          </div>
          <div className="text-right font-mono w-32 space-y-0.5">
            <div>{formatNAD(subtotal)}</div><div>{formatNAD(tax)}</div>
            <div className="font-medium">{formatNAD(subtotal + tax)}</div>
          </div>
        </div>
      </div>
      {invoice.receipt_url && (
        <Button variant="outline" size="sm" onClick={() => void openReceipt()}>
          <Paperclip className="mr-2 h-3.5 w-3.5" /> View attached receipt <ExternalLink className="ml-2 h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ─── Invoice row ──────────────────────────────────────────────────────────────

async function downloadInvoicePdf(invoice: Invoice) {
  const { data, error } = await supabase.functions.invoke("invoice-pdf", { body: { invoice_id: invoice.id } });
  if (error) throw error;
  let blob: Blob;
  if (data instanceof Blob) blob = data;
  else if (data instanceof ArrayBuffer) blob = new Blob([data], { type: "application/pdf" });
  else if (typeof data === "string") {
    const bin = atob(data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: "application/pdf" });
  } else throw new Error("Unexpected response format");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${invoice.invoice_number ?? invoice.id}.pdf`; a.click();
  URL.revokeObjectURL(url);
}

function InvoiceRow({ invoice, canAdmin, canVoid }: { invoice: Invoice; canAdmin: boolean; canVoid: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const isAR = invoice.type === "AR";

  const updateStatus = useMutation({
    mutationFn: async (next: { status: InvoiceStatus; issued_at?: string; paid_at?: string }) => {
      const { error } = await supabase.from("invoices").update(next).eq("id", invoice.id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Invoice updated."); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const onDownload = async () => {
    setDownloading(true);
    try { await downloadInvoicePdf(invoice); }
    catch (err) { toast.error(err instanceof Error ? err.message : "PDF download failed"); }
    finally { setDownloading(false); }
  };

  const party = isAR
    ? (invoice.clients?.name ?? "—")
    : (invoice.vendors?.name ?? "—");

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="py-3 w-8">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="py-3 font-mono text-sm font-medium">
          {invoice.invoice_number ?? invoice.id.slice(0, 8)}
          {invoice.receipt_url && <Paperclip className="ml-1.5 inline h-3 w-3 text-muted-foreground" />}
        </TableCell>
        <TableCell className="py-3">
          <div className="font-medium text-sm">{party}</div>
          {isAR && invoice.sites?.name && (
            <div className="text-xs text-muted-foreground">{invoice.sites.name}</div>
          )}
        </TableCell>
        <TableCell className="py-3 text-sm text-muted-foreground">{invoice.invoice_date ? formatDate(invoice.invoice_date) : "—"}</TableCell>
        <TableCell className="py-3 text-right font-mono text-sm font-medium">{formatNAD(invoice.total)}</TableCell>
        <TableCell className="py-3 text-sm text-muted-foreground">{invoice.due_date ? formatDate(invoice.due_date) : "—"}</TableCell>
        <TableCell className="py-3"><StatusBadge status={invoice.status} /></TableCell>
        <TableCell className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><ChevronDown className="h-3.5 w-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {invoice.status === "draft" && canAdmin && (
                <DropdownMenuItem onClick={() => updateStatus.mutate({ status: "issued", issued_at: new Date().toISOString() })}>
                  <Send className="mr-2 h-3.5 w-3.5" /> {isAR ? "Issue invoice" : "Approve bill"}
                </DropdownMenuItem>
              )}
              {invoice.status === "issued" && canAdmin && (
                <DropdownMenuItem onClick={() => updateStatus.mutate({ status: "paid", paid_at: new Date().toISOString() })}>
                  <CheckCircle className="mr-2 h-3.5 w-3.5" /> Mark as paid
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onDownload} disabled={downloading}>
                {downloading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                Download PDF
              </DropdownMenuItem>
              {invoice.status !== "paid" && invoice.status !== "void" && canVoid && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => updateStatus.mutate({ status: "void" })}>
                    <XCircle className="mr-2 h-3.5 w-3.5" /> Void
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/20 px-6 py-4"><InvoiceDetail invoice={invoice} /></TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function InvoicesPage() {
  const { profile } = useAuth();
  const [docType, setDocType] = useState<InvoiceType>("AR");
  const [tab, setTab] = useState<"all" | InvoiceStatus>("all");
  const [search, setSearch] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const role = profile?.role;
  const canAdmin = role === "admin" || role === "accountant";
  const canGenerate = role === "admin" || role === "operations" || role === "accountant";
  const canVoid = role === "admin" || role === "accountant";

  const { data: tenant = null } = useQuery<TenantBilling | null>({
    queryKey: ["tenant-billing-meta"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants").select("id, default_tax_rate, invoice_due_days").limit(1).maybeSingle();
      if (error) throw error;
      return data as TenantBilling | null;
    },
  });

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", profile?.tenant_id, docType],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(`
          id, invoice_number, type, status, total, tax,
          due_date, invoice_date, issued_at, paid_at, notes, receipt_url, created_at, pay_period_id,
          clients:client_id ( name ),
          sites:site_id ( name ),
          vendors:vendor_id ( name ),
          pay_periods ( label )
        `)
        .eq("type", docType)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Invoice[];
    },
  });

  if (!canAdmin && !canGenerate) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Access restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">Invoicing is available to admin, accountant, and operations roles.</p>
        </div>
      </div>
    );
  }

  const counts = {
    all: invoices.length,
    draft: invoices.filter((i) => i.status === "draft").length,
    issued: invoices.filter((i) => i.status === "issued").length,
    paid: invoices.filter((i) => i.status === "paid").length,
    void: invoices.filter((i) => i.status === "void").length,
  };

  const filtered = invoices.filter((inv) => {
    if (tab !== "all" && inv.status !== tab) return false;
    if (search) {
      const q = search.toLowerCase();
      const party = (inv.clients?.name ?? inv.vendors?.name ?? "").toLowerCase();
      const site = (inv.sites?.name ?? "").toLowerCase();
      const num = (inv.invoice_number ?? "").toLowerCase();
      if (!party.includes(q) && !site.includes(q) && !num.includes(q)) return false;
    }
    return true;
  });

  const outstanding = invoices.filter((i) => i.status === "issued").reduce((s, i) => s + i.total, 0);
  const isAR = docType === "AR";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <Receipt className="h-7 w-7 text-muted-foreground" /> Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAR ? "Receivables — what clients owe you." : "Payables — what you owe suppliers."}
            {outstanding > 0 && (
              <span className="ml-2 font-medium text-blue-600">{formatNAD(outstanding)} {isAR ? "outstanding" : "to pay"}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {isAR && canGenerate && (
            <Button variant="outline" onClick={() => setGenerateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> From payroll
            </Button>
          )}
          {canGenerate && (
            <Button onClick={() => setNewOpen(true)}>
              <FilePlus2 className="mr-2 h-4 w-4" /> New {isAR ? "invoice" : "bill"}
            </Button>
          )}
        </div>
      </header>

      {/* AR / AP switch */}
      <Tabs value={docType} onValueChange={(v) => { setDocType(v as InvoiceType); setTab("all"); }}>
        <TabsList>
          <TabsTrigger value="AR">Receivables (AR)</TabsTrigger>
          <TabsTrigger value="AP">Payables (AP)</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["draft", "issued", "paid", "void"] as InvoiceStatus[]).map((s) => {
          const total = invoices.filter((i) => i.status === s).reduce((a, i) => a + i.total, 0);
          return (
            <button key={s} onClick={() => setTab(s)}
              className={cn("rounded-xl border p-4 text-left transition-all", tab === s ? "ring-2 ring-primary/40 bg-primary/5" : "hover:bg-muted/40")}>
              <p className="text-xs text-muted-foreground capitalize mb-1">{s === "issued" && !isAR ? "approved" : s}</p>
              <p className="text-xl font-bold font-mono">{counts[s]}</p>
              <p className="text-xs text-muted-foreground mt-1">{formatNAD(total)}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="draft">Draft ({counts.draft})</TabsTrigger>
            <TabsTrigger value="issued">{isAR ? "Issued" : "Approved"} ({counts.issued})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({counts.paid})</TabsTrigger>
            <TabsTrigger value="void">Void ({counts.void})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto">
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={isAR ? "Search client, site, invoice #…" : "Search vendor, bill #…"} className="w-full sm:w-72 pl-3" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              {invoices.length === 0
                ? `No ${isAR ? "invoices" : "bills"} yet. Click "New ${isAR ? "invoice" : "bill"}" to create one.`
                : "No records match your filter."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-8" />
                <TableHead>{isAR ? "Invoice #" : "Bill #"}</TableHead>
                <TableHead>{isAR ? "Client" : "Vendor"}</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inv) => <InvoiceRow key={inv.id} invoice={inv} canAdmin={canAdmin} canVoid={canVoid} />)}
            </TableBody>
          </Table>
        )}
      </div>

      <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      <NewInvoiceDialog open={newOpen} onOpenChange={setNewOpen} type={docType} tenant={tenant} />
    </div>
  );
}
