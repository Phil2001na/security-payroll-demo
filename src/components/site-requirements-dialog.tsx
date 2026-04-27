import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAYS = [
  { idx: 1, label: "Mon" },
  { idx: 2, label: "Tue" },
  { idx: 3, label: "Wed" },
  { idx: 4, label: "Thu" },
  { idx: 5, label: "Fri" },
  { idx: 6, label: "Sat" },
  { idx: 0, label: "Sun" },
];

type Row = { day_of_week: number; shift_kind: "day" | "night"; quantity_required: number };

export function SiteRequirementsDialog({
  siteId, siteName, tenantId, canManage, trigger,
}: {
  siteId: string;
  siteName: string;
  tenantId: string;
  canManage: boolean;
  trigger?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [matrix, setMatrix] = useState<Record<string, number>>({}); // key: `${dow}|${kind}`

  const { data, isLoading } = useQuery({
    queryKey: ["site-requirements", siteId],
    enabled: open && !!siteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_requirements")
        .select("day_of_week, shift_kind, quantity_required")
        .eq("site_id", siteId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  useEffect(() => {
    if (!open) return;
    const next: Record<string, number> = {};
    DAYS.forEach((d) => {
      next[`${d.idx}|day`] = 0;
      next[`${d.idx}|night`] = 0;
    });
    (data ?? []).forEach((r) => {
      next[`${r.day_of_week}|${r.shift_kind}`] = r.quantity_required;
    });
    setMatrix(next);
  }, [data, open]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = DAYS.flatMap((d) =>
        (["day", "night"] as const).map((kind) => ({
          tenant_id: tenantId,
          site_id: siteId,
          day_of_week: d.idx,
          shift_kind: kind,
          quantity_required: Math.max(0, Math.floor(matrix[`${d.idx}|${kind}`] ?? 0)),
        }))
      );
      const { error } = await supabase
        .from("site_requirements")
        .upsert(rows, { onConflict: "site_id,day_of_week,shift_kind" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Manpower requirements saved");
      void qc.invalidateQueries({ queryKey: ["site-requirements", siteId] });
      void qc.invalidateQueries({ queryKey: ["site-requirements-all"] });
      setOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  function update(dow: number, kind: "day" | "night", val: string) {
    const n = Number(val);
    setMatrix((p) => ({ ...p, [`${dow}|${kind}`]: isNaN(n) ? 0 : n }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Manpower
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manpower requirements · {siteName}</DialogTitle>
          <DialogDescription>
            Guards required each day of the week, split by Day and Night shift.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[80px_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
              <div>Day</div>
              <div>Day shift</div>
              <div>Night shift</div>
            </div>
            {DAYS.map((d) => {
              const weekend = d.idx === 0 || d.idx === 6;
              return (
                <div
                  key={d.idx}
                  className={`grid grid-cols-[80px_1fr_1fr] gap-2 items-center rounded-md px-2 py-1.5 ${
                    weekend ? "bg-accent/10" : ""
                  }`}
                >
                  <Label className="text-sm font-mono">{d.label}</Label>
                  <Input
                    type="number" min={0} step={1}
                    disabled={!canManage}
                    value={matrix[`${d.idx}|day`] ?? 0}
                    onChange={(e) => update(d.idx, "day", e.target.value)}
                    className="h-8"
                  />
                  <Input
                    type="number" min={0} step={1}
                    disabled={!canManage}
                    value={matrix[`${d.idx}|night`] ?? 0}
                    onChange={(e) => update(d.idx, "night", e.target.value)}
                    className="h-8"
                  />
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          {canManage && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
              {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save requirements
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
