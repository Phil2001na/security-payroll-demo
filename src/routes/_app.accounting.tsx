import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/accounting")({ component: AccountingPage });

function AccountingPage() {
  const { data: aging = [] } = useQuery({
    queryKey: ["ar-aging"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("invoices").select("id,due_date,total,status").eq("type", "AR").neq("status", "paid");
      if (error) throw error;
      const now = new Date();
      return (data ?? []).map((d: { id: string; due_date: string; total: number; status: string }) => {
        const days = Math.floor((now.getTime() - new Date(d.due_date).getTime()) / (1000 * 60 * 60 * 24));
        return { ...d, bucket: days <= 30 ? "0-30" : days <= 60 ? "31-60" : "61-90+" };
      });
    },
  });

  const { data: pl = [] } = useQuery({
    queryKey: ["pl"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("ledger_lines")
        .select("debit,credit,chart_of_accounts!inner(type,name)");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Accounting</h1>
      <Tabs defaultValue="aging">
        <TabsList>
          <TabsTrigger value="aging">Aging Receivables</TabsTrigger>
          <TabsTrigger value="pl">Profit &amp; Loss</TabsTrigger>
          <TabsTrigger value="recon">Reconciliation</TabsTrigger>
        </TabsList>

        <TabsContent value="aging">
          <Card><CardHeader><CardTitle>A/R 30/60/90</CardTitle></CardHeader><CardContent>
            {aging.map((a: any) => <div key={a.id} className="flex justify-between text-sm py-1"><span>{a.id.slice(0,8)} · {a.bucket}</span><span>{Number(a.total).toFixed(2)}</span></div>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pl">
          <Card><CardHeader><CardTitle>Profit &amp; Loss</CardTitle></CardHeader><CardContent>
            {pl.map((line: any, i: number) => <div key={i} className="flex justify-between text-sm py-1"><span>{line.chart_of_accounts.name} ({line.chart_of_accounts.type})</span><span>D {Number(line.debit).toFixed(2)} / C {Number(line.credit).toFixed(2)}</span></div>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="recon">
          <Card><CardHeader><CardTitle>Bank Reconciliation</CardTitle></CardHeader><CardContent>
            <p className="text-sm text-muted-foreground">Match incoming Cash debits to AR invoice credits. Workflow: select bank line → pick invoice → post reconciliation journal.</p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
