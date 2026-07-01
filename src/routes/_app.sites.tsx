import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Loader2, Pencil, Briefcase, Users } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteRequirementsDialog } from "@/components/site-requirements-dialog";
import { SiteContractDialog } from "@/components/site-contract-dialog";
import { SiteSupervisorsPopover } from "@/components/site-supervisors-popover";

export const Route = createFileRoute("/_app/sites")({
  component: SitesPage,
  head: () => ({ meta: [{ title: "Sites — Demo Payroll System" }] }),
});

type Site = {
  id: string;
  name: string;
  code: string | null;
  client_id: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
  required_guard_grade: "A+" | "A" | "B" | "C" | "D" | null;
  clients: { id: string; name: string } | null;
};

type ClientOption = { id: string; name: string };

const GRADE_OPTIONS = [
  { value: "A+", label: "A+ — Fluent, multilingual" },
  { value: "A", label: "A — Fluent reading/writing" },
  { value: "B", label: "B — Okay" },
  { value: "C", label: "C — Limited" },
  { value: "D", label: "D — Minimal (vehicle-standby only)" },
] as const;

const siteSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  code: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(400).optional().or(z.literal("")),
});

function useClientOptions(enabled: boolean) {
  return useQuery<ClientOption[]>({
    queryKey: ["clients-options"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ClientOption[];
    },
  });
}

function ClientSelect({ value, onChange, clients }: {
  value: string; onChange: (v: string) => void; clients: ClientOption[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>Client *</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select the client this site belongs to…" /></SelectTrigger>
        <SelectContent>
          {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {clients.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No active clients yet — <Link to="/clients" className="underline">register the client first</Link>, then add their site.
        </p>
      )}
    </div>
  );
}

function EditSiteDialog({ site, canManage }: { site: Site; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(site.client_id ?? "");
  const [grade, setGrade] = useState<"A+" | "A" | "B" | "C" | "D" | "none">(site.required_guard_grade ?? "none");
  const { data: clients = [] } = useClientOptions(open);

  const save = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Select a client");
      const { error } = await supabase
        .from("sites")
        .update({ client_id: clientId, required_guard_grade: grade === "none" ? null : grade })
        .eq("id", site.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site settings updated");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save"),
  });

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-full">
          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit site — {site.name}</DialogTitle>
          <DialogDescription>
            Client and guard-grade requirement. Billing and invoicing are handled in Accounting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ClientSelect value={clientId} onChange={setClientId} clients={clients} />
          <div className="space-y-1.5">
            <Label>Required guard grade</Label>
            <Select value={grade} onValueChange={(v) => setGrade(v as typeof grade)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No requirement</SelectItem>
                {GRADE_OPTIONS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The schedule generator prefers guards at this grade or better, falling back a grade at a time if not enough are available.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SitesPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  if (role && role !== "admin" && role !== "operations" && role !== "supervisor" && role !== "payroll") {
    return <AccessDenied message="Sites are restricted to payroll and operations staff." />;
  }
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", client_id: "", address: "", required_guard_grade: "none" });
  const { data: clients = [] } = useClientOptions(open);

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, code, client_id, address, active, created_at, required_guard_grade, clients:client_id(id, name)")
        .order("name");
      if (error) throw error;
      return data as unknown as Site[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("No tenant");
      if (!form.client_id) throw new Error("Select a client — register them on the Clients page first.");
      const parsed = siteSchema.parse(form);
      const { error } = await supabase.from("sites").insert({
        tenant_id: profile.tenant_id,
        name: parsed.name,
        code: parsed.code || null,
        client_id: form.client_id,
        address: parsed.address || null,
        required_guard_grade: form.required_guard_grade === "none" ? null : form.required_guard_grade as "A+" | "A" | "B" | "C" | "D",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site created");
      setForm({ name: "", code: "", client_id: "", address: "", required_guard_grade: "none" });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const canManage = role === "admin" || role === "operations" || role === "payroll";

  // Supervisors (attendance-marking role) for the per-site assignment picker.
  const { data: supervisors = [] } = useQuery({
    queryKey: ["site-supervisors", profile?.tenant_id],
    enabled: !!profile?.tenant_id && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, assigned_site_ids")
        .eq("role", "security_supervisor")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; assigned_site_ids: string[] }[];
    },
  });

  const setSiteSupervisors = useMutation({
    mutationFn: async ({ siteId, userIds }: { siteId: string; userIds: string[] }) => {
      const { error } = await supabase.rpc("set_site_supervisors", { p_site: siteId, p_user_ids: userIds });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site supervisors updated");
      void queryClient.invalidateQueries({ queryKey: ["site-supervisors"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const visible = useMemo(() => sites ?? [], [sites]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <MapPin className="h-7 w-7 text-muted-foreground" /> Sites
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Client locations where guards are deployed.{" "}
            {sites && <span className="font-mono">{sites.length} total</span>}
          </p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add site</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New site</DialogTitle>
                <DialogDescription>A deployment location belonging to a registered client.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <ClientSelect value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })} clients={clients} />
                <div className="space-y-1.5">
                  <Label>Site name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Maerua Mall"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="MAERUA"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Required guard grade</Label>
                  <Select
                    value={form.required_guard_grade}
                    onValueChange={(v) => setForm({ ...form, required_guard_grade: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No requirement</SelectItem>
                      {GRADE_OPTIONS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name || !form.client_id}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create site
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              No sites yet.{canManage && " Click \"Add site\" to create the first one."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((s) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    {s.clients && (
                      <CardDescription className="flex items-center gap-1">
                        <Briefcase className="h-3 w-3" /> {s.clients.name}
                      </CardDescription>
                    )}
                  </div>
                  {!s.active && <Badge variant="outline">Inactive</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {s.code && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Code</span>
                    <span className="font-mono">{s.code}</span>
                  </div>
                )}
                {s.required_guard_grade && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min. guard grade</span>
                    <Badge variant="outline">{s.required_guard_grade}</Badge>
                  </div>
                )}
                {s.address && <div className="text-muted-foreground text-xs">{s.address}</div>}
                {profile?.tenant_id && (
                  <div className="pt-2 grid grid-cols-2 gap-2">
                    <EditSiteDialog site={s} canManage={canManage} />
                    {canManage && (
                      <SiteSupervisorsPopover
                        siteId={s.id}
                        supervisors={supervisors}
                        onSave={(userIds) => setSiteSupervisors.mutate({ siteId: s.id, userIds })}
                      />
                    )}
                    <SiteRequirementsDialog
                      siteId={s.id}
                      siteName={s.name}
                      tenantId={profile.tenant_id}
                      canManage={canManage}
                      trigger={
                        <Button variant="outline" size="sm" className="w-full">
                          <Users className="h-3.5 w-3.5 mr-1.5" /> Manpower
                        </Button>
                      }
                    />
                    <SiteContractDialog
                      siteId={s.id}
                      siteName={s.name}
                      canManage={canManage}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
