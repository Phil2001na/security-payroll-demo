import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Save, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_app/admin/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Admin settings — Dog Force Payroll" }] }),
});

type Constant = { key: string; value: number; description: string | null };

function SettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, number>>({});

  if (profile?.role !== "admin") {
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
