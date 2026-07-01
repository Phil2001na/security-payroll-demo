import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, ShieldAlert, AlertTriangle } from "lucide-react";
import { formatNAD, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";

export const Route = createFileRoute("/_app/disciplinary")({
  component: DisciplinaryPage,
});

type ActionType =
  | "verbal_warning" | "written_warning" | "final_warning"
  | "unpaid_suspension" | "fine_with_ca" | "dismissal";

const OFFENCES = [
  "Sleeping on duty", "Late arrival", "Absent without leave",
  "Unprofessional conduct", "Uniform violation", "Insubordination",
  "Theft / dishonesty", "Neglect of duty", "Other",
];

function DisciplinaryPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  if (role && role !== "admin" && role !== "operations" && role !== "supervisor" && role !== "payroll") {
    return <AccessDenied message="Disciplinary records are restricted to operations and payroll staff." />;
  }
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: employees } = useQuery({
    queryKey: ["employees-roster"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees").select("id,employee_code,first_names,surname,display_name,home_site_id")
        .eq("status", "active").order("surname");
      if (error) throw error;
      return data;
    },
  });

  const { data: sites } = useQuery({
    queryKey: ["sites-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id,name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: actions } = useQuery({
    queryKey: ["disciplinary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disciplinary_actions")
        .select("*, employees(id,employee_code,first_names,surname,display_name), sites:incident_site_id(name)")
        .order("incident_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    employee_id: "", action_type: "written_warning" as ActionType,
    offence_code: "Sleeping on duty", incident_date: new Date().toISOString().slice(0, 10),
    incident_site_id: "none", description: "",
    fine_amount: "", collective_agreement_reference: "",
    suspension_hours: "",
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.employee_id) throw new Error("Employee required");
      if (!form.description.trim()) throw new Error("Description required");
      const isFine = form.action_type === "fine_with_ca";
      const isSuspension = form.action_type === "unpaid_suspension";
      if (isFine && !form.collective_agreement_reference.trim()) {
        throw new Error("Collective Agreement reference is mandatory for fines (Labour Act s.12(5))");
      }
      const { error } = await supabase.from("disciplinary_actions").insert({
        tenant_id: profile!.tenant_id,
        employee_id: form.employee_id,
        action_type: form.action_type,
        offence_code: form.offence_code,
        incident_date: form.incident_date,
        incident_site_id: form.incident_site_id === "none" ? null : form.incident_site_id,
        description: form.description,
        fine_amount: isFine ? Number(form.fine_amount || 0) : 0,
        collective_agreement_reference: isFine ? form.collective_agreement_reference : null,
        suspension_hours: isSuspension ? Number(form.suspension_hours || 0) : 0,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Disciplinary action recorded");
      qc.invalidateQueries({ queryKey: ["disciplinary"] });
      setOpen(false);
      setForm({ ...form, employee_id: "", description: "", fine_amount: "", collective_agreement_reference: "", suspension_hours: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const finesWithoutCA = (actions ?? []).filter(
    (a) => a.action_type === "fine_with_ca" && !a.collective_agreement_reference?.trim() && Number(a.fine_amount || 0) > 0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Disciplinary Actions</h1>
          <p className="text-sm text-muted-foreground">
            Offences, unpaid suspensions, and Section 12(5)-compliant fines.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Action</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Record Disciplinary Action</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Employee</Label>
                <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.employee_code} — {e.display_name ?? `${e.first_names} ${e.surname}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Action Type</Label>
                <Select value={form.action_type} onValueChange={(v: ActionType) => setForm({ ...form, action_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verbal_warning">Verbal Warning</SelectItem>
                    <SelectItem value="written_warning">Written Warning</SelectItem>
                    <SelectItem value="final_warning">Final Warning</SelectItem>
                    <SelectItem value="unpaid_suspension">Unpaid Suspension</SelectItem>
                    <SelectItem value="fine_with_ca">Fine (requires CA ref)</SelectItem>
                    <SelectItem value="dismissal">Dismissal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Offence</Label>
                <Select value={form.offence_code} onValueChange={(v) => setForm({ ...form, offence_code: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OFFENCES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Incident Date</Label>
                <Input type="date" value={form.incident_date}
                  onChange={(e) => setForm({ ...form, incident_date: e.target.value })} />
              </div>
              <div>
                <Label>Site (optional)</Label>
                <Select value={form.incident_site_id} onValueChange={(v) => setForm({ ...form, incident_site_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {sites?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {form.action_type === "fine_with_ca" && (
                <>
                  <div>
                    <Label>Fine Amount (N$)</Label>
                    <Input type="number" step="0.01" value={form.fine_amount}
                      onChange={(e) => setForm({ ...form, fine_amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>
                      Collective Agreement Ref <span className="text-destructive">*</span>
                    </Label>
                    <Input placeholder="e.g. DF-CA-2026-§4.2"
                      value={form.collective_agreement_reference}
                      onChange={(e) => setForm({ ...form, collective_agreement_reference: e.target.value })} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Required per Labour Act s.12(5). Without it the fine stays at N$0.
                    </p>
                  </div>
                </>
              )}

              {form.action_type === "unpaid_suspension" && (
                <div>
                  <Label>Suspension Hours (zeroed from payroll)</Label>
                  <Input type="number" step="0.5" value={form.suspension_hours}
                    onChange={(e) => setForm({ ...form, suspension_hours: e.target.value })} />
                </div>
              )}

              <div className="col-span-2">
                <Label>Description / Evidence Notes</Label>
                <Textarea rows={3} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                {createMut.isPending ? "Saving…" : "Record Action"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {finesWithoutCA.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div>
            <strong>{finesWithoutCA.length} fine(s) missing Collective Agreement reference</strong> — these will NOT be deducted from payroll until a CA ref is added.
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />History</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Offence</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Fine</TableHead>
                <TableHead className="text-right">Susp. hrs</TableHead>
                <TableHead>CA Ref</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!actions?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No actions recorded.</TableCell>
                </TableRow>
              ) : actions.map((a: any) => {
                const isFine = a.action_type === "fine_with_ca";
                const missing = isFine && !a.collective_agreement_reference?.trim() && Number(a.fine_amount || 0) > 0;
                return (
                  <TableRow key={a.id}>
                    <TableCell>{formatDate(a.incident_date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {a.employees?.display_name ?? `${a.employees?.first_names} ${a.employees?.surname}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{a.employees?.employee_code}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.action_type === "dismissal" ? "destructive" : "outline"}>
                        {a.action_type.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{a.offence_code}</TableCell>
                    <TableCell className="text-xs">{a.sites?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">{isFine ? formatNAD(Number(a.fine_amount || 0)) : "—"}</TableCell>
                    <TableCell className="text-right">{a.action_type === "unpaid_suspension" ? (a.suspension_hours ?? 0) : "—"}</TableCell>
                    <TableCell>
                      {isFine ? (
                        missing ? (
                          <Badge variant="destructive" className="text-[10px]">MISSING</Badge>
                        ) : (
                          <span className="text-xs font-mono">{a.collective_agreement_reference}</span>
                        )
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
