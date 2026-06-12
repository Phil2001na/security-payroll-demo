import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, TrendingUp, TrendingDown, Wallet, Landmark, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatNAD } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/accounting")({
  component: AccountingPage,
  head: () => ({ meta: [{ title: "Accounting — Demo Payroll System" }] }),
});

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
type LedgerLine = {
  debit: number; credit: number;
  chart_of_accounts: { code: string; name: string; type: AccountType; normal_balance: "debit" | "credit" } | null;
};
type AgingInvoice = { id: string; invoice_number: string | null; total: number; due_date: string | null; clients: { name: string } | null };
type ApInvoice = { id: string; invoice_number: string | null; total: number; due_date: string | null; vendors: { name: string } | null };

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className={cn("text-2xl font-bold font-mono", tone === "pos" && "text-emerald-600", tone === "neg" && "text-destructive")}>{value}</p>
    </div>
  );
}

function AccountingPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canView = role === "admin" || role === "accountant" || role === "operations";

  const { data: lines = [], isLoading: linesLoading } = useQuery<LedgerLine[]>({
    queryKey: ["ledger-lines"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_lines")
        .select("debit, credit, chart_of_accounts!inner(code, name, type, normal_balance)");
      if (error) throw error;
      return (data ?? []) as unknown as LedgerLine[];
    },
  });

  const { data: arInvoices = [] } = useQuery<AgingInvoice[]>({
    queryKey: ["ar-aging"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, total, due_date, clients:client_id(name)")
        .eq("type", "AR").eq("status", "issued");
      if (error) throw error;
      return (data ?? []) as unknown as AgingInvoice[];
    },
  });

  const { data: apInvoices = [] } = useQuery<ApInvoice[]>({
    queryKey: ["ap-outstanding"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, total, due_date, vendors:vendor_id(name)")
        .eq("type", "AP").eq("status", "issued");
      if (error) throw error;
      return (data ?? []) as unknown as ApInvoice[];
    },
  });

  // Aggregate ledger by account
  const accounts = useMemo(() => {
    const map = new Map<string, { code: string; name: string; type: AccountType; normal: "debit" | "credit"; debit: number; credit: number }>();
    for (const l of lines) {
      const a = l.chart_of_accounts;
      if (!a) continue;
      const cur = map.get(a.code) ?? { code: a.code, name: a.name, type: a.type, normal: a.normal_balance, debit: 0, credit: 0 };
      cur.debit += Number(l.debit || 0);
      cur.credit += Number(l.credit || 0);
      map.set(a.code, cur);
    }
    return [...map.values()].sort((x, y) => x.code.localeCompare(y.code));
  }, [lines]);

  const totals = useMemo(() => {
    let revenue = 0, expenses = 0, debits = 0, credits = 0, cash = 0;
    for (const a of accounts) {
      debits += a.debit; credits += a.credit;
      if (a.type === "income") revenue += a.credit - a.debit;
      if (a.type === "expense") expenses += a.debit - a.credit;
      if (a.code === "1001") cash += a.debit - a.credit;
    }
    return { revenue, expenses, profit: revenue - expenses, debits, credits, cash };
  }, [accounts]);

  const aging = useMemo(() => {
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    const now = Date.now();
    for (const inv of arInvoices) {
      const days = inv.due_date ? Math.floor((now - new Date(inv.due_date).getTime()) / 86400000) : 0;
      const amt = Number(inv.total || 0);
      if (days <= 0) buckets.current += amt;
      else if (days <= 30) buckets.d30 += amt;
      else if (days <= 60) buckets.d60 += amt;
      else if (days <= 90) buckets.d90 += amt;
      else buckets.over += amt;
    }
    return buckets;
  }, [arInvoices]);

  const arOutstanding = arInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const apOutstanding = apInvoices.reduce((s, i) => s + Number(i.total || 0), 0);

  if (!canView) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <Calculator className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Access restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">Accounting is available to admin, accountant and operations roles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
          <Calculator className="h-7 w-7 text-muted-foreground" /> Accounting
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live double-entry ledger — posted automatically from issued invoices, payments and finalized payroll.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={TrendingUp} label="Revenue" value={formatNAD(totals.revenue)} tone="pos" />
        <StatCard icon={TrendingDown} label="Expenses" value={formatNAD(totals.expenses)} tone="neg" />
        <StatCard icon={Wallet} label="Net profit" value={formatNAD(totals.profit)} tone={totals.profit >= 0 ? "pos" : "neg"} />
        <StatCard icon={Landmark} label="Cash at bank" value={formatNAD(totals.cash)} />
        <StatCard icon={TrendingUp} label="AR outstanding" value={formatNAD(arOutstanding)} />
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">Profit &amp; Loss</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="aging">AR Aging</TabsTrigger>
          <TabsTrigger value="ap">Payables</TabsTrigger>
        </TabsList>

        {linesLoading ? (
          <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></div>
        ) : (
          <>
            <TabsContent value="pl">
              <Card>
                <CardHeader>
                  <CardTitle>Profit &amp; Loss</CardTitle>
                  <CardDescription>Income less expenses across the live ledger.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30"><TableCell className="font-medium">Income</TableCell><TableCell /></TableRow>
                      {accounts.filter((a) => a.type === "income").map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="pl-6">{a.code} · {a.name}</TableCell>
                          <TableCell className="text-right font-mono">{formatNAD(a.credit - a.debit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/30"><TableCell className="font-medium">Expenses</TableCell><TableCell /></TableRow>
                      {accounts.filter((a) => a.type === "expense").map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="pl-6">{a.code} · {a.name}</TableCell>
                          <TableCell className="text-right font-mono">{formatNAD(a.debit - a.credit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell className="font-bold">Net profit / (loss)</TableCell>
                        <TableCell className={cn("text-right font-mono font-bold", totals.profit >= 0 ? "text-emerald-600" : "text-destructive")}>
                          {formatNAD(totals.profit)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  {accounts.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No ledger activity yet. Issue an invoice or finalize payroll to post entries.</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tb">
              <Card>
                <CardHeader>
                  <CardTitle>Trial Balance</CardTitle>
                  <CardDescription>All accounts. Total debits must equal total credits.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead><TableHead>Account</TableHead>
                        <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="font-mono text-xs">{a.code}</TableCell>
                          <TableCell>{a.name}</TableCell>
                          <TableCell className="text-right font-mono">{a.debit ? formatNAD(a.debit) : "—"}</TableCell>
                          <TableCell className="text-right font-mono">{a.credit ? formatNAD(a.credit) : "—"}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={2}>Totals</TableCell>
                        <TableCell className="text-right font-mono">{formatNAD(totals.debits)}</TableCell>
                        <TableCell className="text-right font-mono">{formatNAD(totals.credits)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <p className={cn("text-xs mt-3", Math.abs(totals.debits - totals.credits) < 0.01 ? "text-emerald-600" : "text-destructive")}>
                    {Math.abs(totals.debits - totals.credits) < 0.01 ? "✓ Ledger is balanced." : "⚠ Ledger is out of balance."}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="aging">
              <Card>
                <CardHeader>
                  <CardTitle>Receivables Aging</CardTitle>
                  <CardDescription>Issued, unpaid client invoices by age past due.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {([["Current", aging.current], ["1–30", aging.d30], ["31–60", aging.d60], ["61–90", aging.d90], ["90+", aging.over]] as const).map(([label, val]) => (
                      <div key={label} className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">{label} days</p>
                        <p className="font-mono font-semibold">{formatNAD(val)}</p>
                      </div>
                    ))}
                  </div>
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {arInvoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-sm">{inv.invoice_number ?? inv.id.slice(0, 8)}</TableCell>
                          <TableCell>{inv.clients?.name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{inv.due_date ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{formatNAD(inv.total)}</TableCell>
                        </TableRow>
                      ))}
                      {arInvoices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No outstanding receivables.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ap">
              <Card>
                <CardHeader>
                  <CardTitle>Payables</CardTitle>
                  <CardDescription>Approved, unpaid supplier bills. {apOutstanding > 0 && <span className="font-medium text-foreground">{formatNAD(apOutstanding)} to pay.</span>}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Vendor</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {apInvoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-sm">{inv.invoice_number ?? inv.id.slice(0, 8)}</TableCell>
                          <TableCell>{inv.vendors?.name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{inv.due_date ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{formatNAD(inv.total)}</TableCell>
                        </TableRow>
                      ))}
                      {apInvoices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No outstanding payables.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
