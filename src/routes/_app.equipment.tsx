import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Boxes, PackageCheck, Undo2 } from "lucide-react";
import { formatNAD, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { canWriteEquipment } from "@/lib/permissions";
import {
  IssueEquipmentDialog,
  CloseIssueDialog,
  ISSUE_STATUS_BADGE,
} from "@/components/equipment-dialogs";

export const Route = createFileRoute("/_app/equipment")({
  component: EquipmentPage,
});

const CATEGORIES = ["uniform", "radio", "firearm", "torch", "vehicle", "other"] as const;

function EquipmentPage() {
  const { profile } = useAuth();
  const canWrite = canWriteEquipment(profile?.role);

  const { data: items } = useQuery({
    queryKey: ["equipment-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_items")
        .select("*")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: issues } = useQuery({
    queryKey: ["equipment-issues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_issues")
        .select(
          "*, equipment_items(name,category,unit_cost), employees(id,employee_code,first_names,surname,display_name)",
        )
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Equipment & Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Uniforms and equipment stock, issuance to guards, and the return audit trail.
        </p>
      </div>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="issued">Issued items</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4 pt-2">
          <InventoryTab items={items} canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="issued" className="space-y-4 pt-2">
          <IssuedTab issues={issues} items={items} canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Inventory tab ---------------- */

function InventoryTab({ items, canWrite }: { items: any[] | undefined; canWrite: boolean }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const emptyForm = {
    name: "",
    category: "uniform",
    sku: "",
    unit_cost: "",
    quantity: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      name: item.name,
      category: item.category,
      sku: item.sku ?? "",
      unit_cost: item.unit_cost != null ? String(item.unit_cost) : "",
      quantity: "",
      notes: item.notes ?? "",
    });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Item name required");
      const qtyDelta = Number(form.quantity || 0);
      if (!editing && qtyDelta < 0) throw new Error("Quantity cannot be negative");
      const base = {
        name: form.name.trim(),
        category: form.category,
        sku: form.sku.trim() || null,
        unit_cost: form.unit_cost === "" ? 0 : Number(form.unit_cost),
        notes: form.notes.trim() || null,
      };
      if (editing) {
        // qtyDelta adds/removes stock: adjust total and available together.
        const { error } = await supabase
          .from("equipment_items")
          .update({
            ...base,
            quantity_total: editing.quantity_total + qtyDelta,
            quantity_available: editing.quantity_available + qtyDelta,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("equipment_items").insert({
          ...base,
          tenant_id: profile!.tenant_id,
          quantity_total: qtyDelta,
          quantity_available: qtyDelta,
          created_by: profile!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Item updated" : "Item added to inventory");
      qc.invalidateQueries({ queryKey: ["equipment-items"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex justify-end">
        {canWrite && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) {
                setEditing(null);
                setForm(emptyForm);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editing ? `Edit — ${editing.name}` : "Add Inventory Item"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. Uniform shirt (L)"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>SKU / Ref (optional)</Label>
                  <Input
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Replacement cost (N$ each)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.unit_cost}
                    onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{editing ? "Adjust stock (+/−)" : "Quantity in stock"}</Label>
                  <Input
                    type="number"
                    value={form.quantity}
                    placeholder={editing ? "0" : ""}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                  {editing && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Current: {editing.quantity_available} available of {editing.quantity_total}{" "}
                      total. Enter e.g. 5 to add stock or -2 to write off.
                    </p>
                  )}
                </div>
                <div className="col-span-2">
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
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  {saveMut.isPending ? "Saving…" : editing ? "Save Changes" : "Add Item"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            Stock on hand
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Replacement cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Issued out</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No inventory items yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell>
                      <div className="font-medium">{it.name}</div>
                      {it.sku && (
                        <div className="text-xs text-muted-foreground font-mono">{it.sku}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {it.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNAD(Number(it.unit_cost || 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono">{it.quantity_total}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span
                        className={
                          it.quantity_available === 0 ? "text-destructive font-semibold" : ""
                        }
                      >
                        {it.quantity_available}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {it.quantity_total - it.quantity_available}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(it)}>
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/* ---------------- Issued tab ---------------- */

function IssuedTab({
  issues,
  items,
  canWrite,
}: {
  issues: any[] | undefined;
  items: any[] | undefined;
  canWrite: boolean;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const rows = (issues ?? []).filter((i: any) => showClosed || i.status === "issued");

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={showClosed} onCheckedChange={(v) => setShowClosed(v === true)} />
          Show returned / lost / damaged
        </label>
        {canWrite && (
          <IssueEquipmentDialog
            items={items}
            trigger={
              <Button>
                <PackageCheck className="h-4 w-4 mr-2" />
                Issue Equipment
              </Button>
            }
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Issuance ledger
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issued</TableHead>
                <TableHead>Guard</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Returned</TableHead>
                <TableHead>Signed</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Nothing issued{showClosed ? "" : " (or everything has been returned)"}.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((i: any) => {
                  const badge = ISSUE_STATUS_BADGE[i.status] ?? ISSUE_STATUS_BADGE.issued;
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(i.issued_at)}</TableCell>
                      <TableCell>
                        <Link
                          to="/employees/$employeeId"
                          params={{ employeeId: i.employee_id }}
                          className="font-medium hover:underline"
                        >
                          {i.employees?.display_name ??
                            `${i.employees?.first_names} ${i.employees?.surname}`}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {i.employees?.employee_code}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{i.equipment_items?.name}</div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {i.equipment_items?.category}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{i.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                        {i.status === "returned" && i.condition_on_return && (
                          <div className="text-xs text-muted-foreground capitalize mt-0.5">
                            {i.condition_on_return}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {i.returned_at ? formatDate(i.returned_at) : "—"}
                      </TableCell>
                      <TableCell>{i.acknowledged ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {i.charge_amount != null && Number(i.charge_amount) > 0
                          ? formatNAD(Number(i.charge_amount))
                          : "—"}
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          {i.status === "issued" && (
                            <CloseIssueDialog
                              issue={i}
                              trigger={
                                <Button size="sm" variant="outline">
                                  <Undo2 className="h-3.5 w-3.5 mr-1" />
                                  Return
                                </Button>
                              }
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
