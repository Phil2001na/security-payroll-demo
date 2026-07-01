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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DAYS = [
  { idx: 1, label: "Mon" },
  { idx: 2, label: "Tue" },
  { idx: 3, label: "Wed" },
  { idx: 4, label: "Thu" },
  { idx: 5, label: "Fri" },
  { idx: 6, label: "Sat" },
  { idx: 0, label: "Sun" },
];

const AUTO = "__auto";

type Row = {
  day_of_week: number;
  shift_kind: "day" | "night";
  quantity_required: number;
  shift_type_id: string | null;
};
type ShiftTemplate = { id: string; label: string; period: string; default_hours: number };

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
  const [qty, setQty] = useState<Record<string, number>>({}); // key: `${dow}|${kind}`
  const [shiftType, setShiftType] = useState<Record<string, string>>({}); // key: `${dow}|${kind}` -> shift_type_id or AUTO

  const { data, isLoading } = useQuery({
    queryKey: ["site-requirements", siteId],
    enabled: open && !!siteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_requirements")
        .select("day_of_week, shift_kind, quantity_required, shift_type_id")
        .eq("site_id", siteId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: templates = [] } = useQuery<ShiftTemplate[]>({
    queryKey: ["shift-templates", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types")
        .select("id, label, period, default_hours")
        .eq("tenant_id", tenantId).eq("active", true).eq("is_leave", false).eq("pay_rule", "standard")
        .order("default_hours");
      if (error) throw error;
      return (data ?? []) as ShiftTemplate[];
    },
  });
  // "Standard shift" already represents the tenant's normal 12h template, so only
  // surface the shorter alternative (e.g. a 6h half shift) as an extra explicit choice.
  const dayTemplates = templates.filter((t) => ["day", "full_day", "morning"].includes(t.period) && t.default_hours < 12);
  const nightTemplates = templates.filter((t) => t.period === "night" && t.default_hours < 12);

  useEffect(() => {
    if (!open) return;
    const nextQty: Record<string, number> = {};
    const nextShift: Record<string, string> = {};
    DAYS.forEach((d) => {
      (["day", "night"] as const).forEach((kind) => {
        nextQty[`${d.idx}|${kind}`] = 0;
        nextShift[`${d.idx}|${kind}`] = AUTO;
      });
    });
    (data ?? []).forEach((r) => {
      nextQty[`${r.day_of_week}|${r.shift_kind}`] = r.quantity_required;
      nextShift[`${r.day_of_week}|${r.shift_kind}`] = r.shift_type_id ?? AUTO;
    });
    setQty(nextQty);
    setShiftType(nextShift);
  }, [data, open]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = DAYS.flatMap((d) =>
        (["day", "night"] as const).map((kind) => {
          const k = `${d.idx}|${kind}`;
          const st = shiftType[k];
          return {
            tenant_id: tenantId,
            site_id: siteId,
            day_of_week: d.idx,
            shift_kind: kind,
            quantity_required: Math.max(0, Math.floor(qty[k] ?? 0)),
            shift_type_id: !st || st === AUTO ? null : st,
          };
        })
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

  function updateQty(dow: number, kind: "day" | "night", val: string) {
    const n = Number(val);
    setQty((p) => ({ ...p, [`${dow}|${kind}`]: isNaN(n) ? 0 : n }));
  }
  function updateShiftType(dow: number, kind: "day" | "night", val: string) {
    setShiftType((p) => ({ ...p, [`${dow}|${kind}`]: val }));
  }
  function closeDay(dow: number) {
    setQty((p) => ({ ...p, [`${dow}|day`]: 0, [`${dow}|night`]: 0 }));
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manpower requirements · {siteName}</DialogTitle>
          <DialogDescription>
            Guards required each day, by Day and Night shift. Pin a shorter shift template (e.g. a 6h
            half shift) per day if this site doesn't need a full 12h coverage block, or zero out a day
            it doesn't need guards at all.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {DAYS.map((d) => {
              const weekend = d.idx === 0 || d.idx === 6;
              const dayQty = qty[`${d.idx}|day`] ?? 0;
              const nightQty = qty[`${d.idx}|night`] ?? 0;
              const closed = dayQty === 0 && nightQty === 0;
              return (
                <div
                  key={d.idx}
                  className={cn("rounded-md border p-3", weekend && "bg-accent/10")}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">{d.label}</Label>
                    <div className="flex items-center gap-2">
                      {closed && <Badge variant="outline" className="text-[10px]">No guards</Badge>}
                      {canManage && !closed && (
                        <button
                          type="button"
                          onClick={() => closeDay(d.idx)}
                          className="text-[11px] text-muted-foreground hover:text-foreground underline"
                        >
                          Mark no guards
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(["day", "night"] as const).map((kind) => {
                      const k = `${d.idx}|${kind}`;
                      const options = kind === "day" ? dayTemplates : nightTemplates;
                      return (
                        <div key={kind} className="space-y-1.5">
                          <Label className="text-[10px] uppercase text-muted-foreground tracking-wide">
                            {kind === "day" ? "Day shift" : "Night shift"}
                          </Label>
                          <div className="flex gap-1.5">
                            <Input
                              type="number" min={0} step={1}
                              disabled={!canManage}
                              value={qty[k] ?? 0}
                              onChange={(e) => updateQty(d.idx, kind, e.target.value)}
                              className="h-8 w-16 shrink-0"
                            />
                            <Select
                              disabled={!canManage}
                              value={shiftType[k] ?? AUTO}
                              onValueChange={(v) => updateShiftType(d.idx, kind, v)}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={AUTO}>Standard shift (12h)</SelectItem>
                                {options.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.label} ({t.default_hours}h)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
