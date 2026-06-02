import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, Plus, Download, ChevronDown, ChevronRight, Loader2,
  Send, CheckCircle, XCircle, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatNAD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Invoices — Dog Force Payroll" }] }),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = "draft" | "issued" | "paid" | "void";

type Invoice = {
  id: string;
  invoice_number: string | null;
  type: "AR" | "AP";
  status: InvoiceStatus;
  total: number;
  tax: number;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  pay_period_id: string | null;
  sites: { name: string; client_name: string | null; billing_rate: number | null } | null;
  pay_periods: { label: string; start_date: string; end_date: string } | null;
};

type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
};

type PayPeriod = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
};

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

// ─── Generate invoices dialog ─────────────────────────────────────────────────

function GenerateDialog({
  open,
  onOpenChange,
  canGenerate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canGenerate: boolean;
}) {
  const qc = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const { data: periods = [] } = useQuery<PayPeriod[]>({
    queryKey: ["pay-periods-for-billing"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .select("id, label, start_date, end_date, status")
        .in("status", ["locked", "paid"])
        .order("start_date", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as PayPeriod[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedPeriod) throw new Error("Select a pay period");
      const period = periods.find((p) => p.id === selectedPeriod);
      if (!period) throw new Error("Period not found");
      const { data, error } = await supabase.functions.invoke("billing-engine", {
        body: {
          startDate: period.start_date,
          endDate: period.end_date,
          payPeriodId: selectedPeriod,
          issue: false,
        },
      });
      if (error) throw error;
      return data as { invoices: unknown[] };
    },
    onSuccess: (data) => {
      const count = data.invoices?.length ?? 0;
      if (count === 0) {
        toast.warning("No approved shifts with a billing rate found for this period.");
      } else {
        toast.success(`${count} invoice${count !== 1 ? "s" : ""} created as drafts.`);
      }
      onOpenChange(false);
      setSelectedPeriod("");
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Generation failed"),
  });

  if (!canGenerate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate invoices from payroll period</DialogTitle>
          <DialogDescription>
            Aggregates all approved shift hours per site and creates one draft AR invoice per client.
            Sites must have a billing rate set.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pay period *</Label>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger>
                <SelectValue placeholder="Select a period…" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    <span className="ml-2 text-xs text-muted-foreground capitalize">({p.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Due date (optional override)</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Defaults to the period end date if left blank.</p>
          </div>
          <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-sm text-amber-800 flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Only approved shifts are included. Sites with no billing rate set are skipped.
              Invoices are created as <strong>drafts</strong> — you review and issue them manually.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || !selectedPeriod}>
            {generate.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Generate drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Line items expansion ─────────────────────────────────────────────────────

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { data: items = [], isLoading } = useQuery<InvoiceItem[]>({
    queryKey: ["invoice-items", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("id, description, quantity, unit_price")
        .eq("invoice_id", invoiceId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as InvoiceItem[];
    },
  });

  if (isLoading) {
    return (
      <div className="py-4 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">No line items found.</p>;
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  return (
    <div className="rounded-lg border overflow-hidden text-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="py-2">Description</TableHead>
            <TableHead className="py-2 text-right w-24">Hours</TableHead>
            <TableHead className="py-2 text-right w-32">Rate</TableHead>
            <TableHead className="py-2 text-right w-32">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="py-2">{item.description}</TableCell>
              <TableCell className="py-2 text-right font-mono">{Number(item.quantity).toFixed(2)}</TableCell>
              <TableCell className="py-2 text-right font-mono">{formatNAD(item.unit_price)}</TableCell>
              <TableCell className="py-2 text-right font-mono">{formatNAD(item.quantity * item.unit_price)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t bg-muted/30 px-4 py-2.5 flex justify-end gap-8 text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="font-mono font-medium w-32 text-right">{formatNAD(subtotal)}</span>
      </div>
    </div>
  );
}

// ─── Invoice row ──────────────────────────────────────────────────────────────

function InvoiceRow({
  invoice,
  canAdmin,
  canVoid,
}: {
  invoice: Invoice;
  canAdmin: boolean;
  canVoid: boolean;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const updateStatus = useMutation({
    mutationFn: async (next: { status: InvoiceStatus; issued_at?: string; paid_at?: string }) => {
      const { error } = await supabase
        .from("invoices")
        .update(next)
        .eq("id", invoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice updated.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { data, error } = await supabase.functions.invoke("invoice-pdf", {
        body: { invoice_id: invoice.id },
      });
      if (error) throw error;
      // invoice-pdf returns raw bytes — handle both ArrayBuffer and base64
      let blob: Blob;
      if (data instanceof ArrayBuffer) {
        blob = new Blob([data], { type: "application/pdf" });
      } else if (typeof data === "string") {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: "application/pdf" });
      } else {
        throw new Error("Unexpected response format");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoice_number ?? invoice.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF download failed");
    } finally {
      setDownloading(false);
    }
  };

  const client = invoice.sites?.client_name ?? invoice.sites?.name ?? "—";
  const period = invoice.pay_periods?.label ?? "—";

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="py-3 w-8">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="py-3 font-mono text-sm font-medium">
          {invoice.invoice_number ?? invoice.id.slice(0, 8)}
        </TableCell>
        <TableCell className="py-3">
          <div className="font-medium text-sm">{client}</div>
          {invoice.sites?.name && invoice.sites.name !== client && (
            <div className="text-xs text-muted-foreground">{invoice.sites.name}</div>
          )}
        </TableCell>
        <TableCell className="py-3 text-sm text-muted-foreground">{period}</TableCell>
        <TableCell className="py-3 text-right font-mono text-sm font-medium">
          {formatNAD(invoice.total)}
        </TableCell>
        <TableCell className="py-3 text-sm text-muted-foreground">
          {invoice.due_date ? formatDate(invoice.due_date) : "—"}
        </TableCell>
        <TableCell className="py-3">
          <StatusBadge status={invoice.status} />
        </TableCell>
        <TableCell className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {invoice.status === "draft" && canAdmin && (
                <DropdownMenuItem
                  onClick={() =>
                    updateStatus.mutate({ status: "issued", issued_at: new Date().toISOString() })
                  }
                >
                  <Send className="mr-2 h-3.5 w-3.5" /> Issue invoice
                </DropdownMenuItem>
              )}
              {invoice.status === "issued" && canAdmin && (
                <DropdownMenuItem
                  onClick={() =>
                    updateStatus.mutate({ status: "paid", paid_at: new Date().toISOString() })
                  }
                >
                  <CheckCircle className="mr-2 h-3.5 w-3.5" /> Mark as paid
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={downloadPdf} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-2 h-3.5 w-3.5" />
                )}
                Download PDF
              </DropdownMenuItem>
              {invoice.status !== "paid" && invoice.status !== "void" && canVoid && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => updateStatus.mutate({ status: "void" })}
                  >
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
          <TableCell colSpan={8} className="bg-muted/20 px-6 py-4">
            <InvoiceDetail invoiceId={invoice.id} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function InvoicesPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"all" | InvoiceStatus>("all");
  const [search, setSearch] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);

  const role = profile?.role;
  const canAdmin = role === "admin" || role === "accountant";
  const canGenerate = role === "admin" || role === "operations" || role === "accountant";
  const canVoid = role === "admin" || role === "accountant";

  if (!canAdmin && !canGenerate) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Access restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoicing is available to admin, accountant, and operations roles.
          </p>
        </div>
      </div>
    );
  }

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(`
          id, invoice_number, type, status, total, tax,
          due_date, issued_at, paid_at, notes, created_at, pay_period_id,
          sites ( name, client_name, billing_rate ),
          pay_periods ( label, start_date, end_date )
        `)
        .eq("type", "AR")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

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
      const client = (inv.sites?.client_name ?? inv.sites?.name ?? "").toLowerCase();
      const num = (inv.invoice_number ?? "").toLowerCase();
      const period = (inv.pay_periods?.label ?? "").toLowerCase();
      if (!client.includes(q) && !num.includes(q) && !period.includes(q)) return false;
    }
    return true;
  });

  const outstandingTotal = invoices
    .filter((i) => i.status === "issued")
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <Receipt className="h-7 w-7 text-muted-foreground" /> Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AR invoices generated from approved shift hours.
            {outstandingTotal > 0 && (
              <span className="ml-2 font-medium text-blue-600">
                {formatNAD(outstandingTotal)} outstanding
              </span>
            )}
          </p>
        </div>
        {canGenerate && (
          <Button onClick={() => setGenerateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Generate invoices
          </Button>
        )}
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["draft", "issued", "paid", "void"] as InvoiceStatus[]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          const total = invoices.filter((i) => i.status === s).reduce((a, i) => a + i.total, 0);
          return (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={cn(
                "rounded-xl border p-4 text-left transition-all",
                tab === s ? "ring-2 ring-primary/40 bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <p className="text-xs text-muted-foreground capitalize mb-1">{s}</p>
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
            <TabsTrigger value="issued">Issued ({counts.issued})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({counts.paid})</TabsTrigger>
            <TabsTrigger value="void">Void ({counts.void})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:ml-auto">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, invoice #, period…"
            className="w-full sm:w-72 pl-3"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              {invoices.length === 0
                ? 'No invoices yet. Click "Generate invoices" to create the first batch.'
                : "No invoices match your filter."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-8" />
                <TableHead>Invoice #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoice={inv}
                  canAdmin={canAdmin}
                  canVoid={canVoid}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        canGenerate={canGenerate}
      />
    </div>
  );
}
