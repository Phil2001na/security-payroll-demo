import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const ISSUE_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  issued: { label: "Issued", className: "bg-warning/15 text-warning border-warning/40" },
  returned: { label: "Returned", className: "bg-success/15 text-success border-success/30" },
  lost: { label: "Lost", className: "bg-destructive/15 text-destructive border-destructive/30" },
  damaged: {
    label: "Damaged",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

export function IssueEquipmentDialog({
  items,
  presetEmployeeId,
  trigger,
  onDone,
}: {
  items: any[] | undefined;
  presetEmployeeId?: string;
  trigger: React.ReactNode;
  onDone?: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const emptyForm = {
    employee_id: presetEmployeeId ?? "",
    item_id: "",
    quantity: "1",
    acknowledged: false,
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const { data: employees } = useQuery({
    queryKey: ["employees-roster"],
    enabled: open && !presetEmployeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,employee_code,first_names,surname,display_name")
        .eq("status", "active")
        .order("surname");
      if (error) throw error;
      return data;
    },
  });

  const issueMut = useMutation({
    mutationFn: async () => {
      if (!form.employee_id) throw new Error("Guard required");
      if (!form.item_id) throw new Error("Item required");
      const qty = Number(form.quantity || 0);
      if (qty < 1) throw new Error("Quantity must be at least 1");
      const { error } = await supabase.from("equipment_issues").insert({
        tenant_id: profile!.tenant_id,
        item_id: form.item_id,
        employee_id: form.employee_id,
        quantity: qty,
        issued_by: profile!.id,
        acknowledged: form.acknowledged,
        notes: form.notes.trim() || null,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Equipment issued");
      qc.invalidateQueries({ queryKey: ["equipment-issues"] });
      qc.invalidateQueries({ queryKey: ["equipment-items"] });
      qc.invalidateQueries({ queryKey: ["employee-equipment"] });
      setOpen(false);
      setForm(emptyForm);
      onDone?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const availableItems = (items ?? []).filter((it: any) => it.is_active);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Equipment</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {!presetEmployeeId && (
            <div className="col-span-2">
              <Label>Guard</Label>
              <Select
                value={form.employee_id}
                onValueChange={(v) => setForm({ ...form, employee_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select guard" />
                </SelectTrigger>
                <SelectContent>
                  {employees?.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employee_code} — {e.display_name ?? `${e.first_names} ${e.surname}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2">
            <Label>Item</Label>
            <Select value={form.item_id} onValueChange={(v) => setForm({ ...form, item_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select item" />
              </SelectTrigger>
              <SelectContent>
                {availableItems.map((it: any) => (
                  <SelectItem key={it.id} value={it.id} disabled={it.quantity_available < 1}>
                    {it.name} ({it.quantity_available} available)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Quantity</Label>
            <Input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.acknowledged}
                onCheckedChange={(v) => setForm({ ...form, acknowledged: v === true })}
              />
              Guard signed receipt
            </label>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              placeholder="e.g. size, serial number, condition when issued"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => issueMut.mutate()} disabled={issueMut.isPending}>
            {issueMut.isPending ? "Issuing…" : "Issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseIssueDialog({ issue, trigger }: { issue: any; trigger: React.ReactNode }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unitCost = Number(issue.equipment_items?.unit_cost ?? issue.charge_amount ?? 0);
  const [form, setForm] = useState({
    status: "returned",
    condition_on_return: "good",
    charge_amount: String((unitCost * issue.quantity).toFixed(2)),
    notes: "",
  });
  const isCharge = form.status === "lost" || form.status === "damaged";

  const closeMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("equipment_issues")
        .update({
          status: form.status,
          returned_at: new Date().toISOString(),
          returned_to: profile!.id,
          condition_on_return: form.status === "returned" ? form.condition_on_return : null,
          charge_amount: isCharge ? Number(form.charge_amount || 0) : null,
          notes: form.notes.trim()
            ? [issue.notes, form.notes.trim()].filter(Boolean).join(" | ")
            : issue.notes,
        })
        .eq("id", issue.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        form.status === "returned" ? "Item returned to stock" : `Marked as ${form.status}`,
      );
      qc.invalidateQueries({ queryKey: ["equipment-issues"] });
      qc.invalidateQueries({ queryKey: ["equipment-items"] });
      qc.invalidateQueries({ queryKey: ["employee-equipment"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close out — {issue.equipment_items?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Outcome</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="returned">Returned to stock</SelectItem>
                <SelectItem value="lost">Lost (not returned)</SelectItem>
                <SelectItem value="damaged">Damaged (written off)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.status === "returned" && (
            <div>
              <Label>Condition on return</Label>
              <Select
                value={form.condition_on_return}
                onValueChange={(v) => setForm({ ...form, condition_on_return: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="worn">Worn</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {isCharge && (
            <div>
              <Label>Replacement charge (N$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.charge_amount}
                onChange={(e) => setForm({ ...form, charge_amount: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Recorded against the guard for reference. Payroll deduction stays a manual step in
                the Deductions module.
              </p>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
            {closeMut.isPending ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
