import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Plus, Loader2, Pencil, MapPin, Mail, Phone, Search } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_app/clients")({
  component: ClientsPage,
  head: () => ({ meta: [{ title: "Clients — Demo Payroll System" }] }),
});

type Client = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  sites: { id: string; name: string }[];
};

const clientSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(160),
  contact_person: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  vat_number: z.string().trim().max(40).optional().or(z.literal("")),
  payment_terms_days: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().max(400).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type ClientForm = z.infer<typeof clientSchema>;

const EMPTY_FORM: ClientForm = {
  name: "", contact_person: "", email: "", phone: "",
  vat_number: "", payment_terms_days: "", address: "", notes: "",
};

function toRow(form: ClientForm) {
  const parsed = clientSchema.parse(form);
  const terms = parsed.payment_terms_days ? Number(parsed.payment_terms_days) : null;
  if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) {
    throw new Error("Payment terms must be a whole number of days (0–365).");
  }
  return {
    name: parsed.name,
    contact_person: parsed.contact_person || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    vat_number: parsed.vat_number || null,
    payment_terms_days: terms,
    address: parsed.address || null,
    notes: parsed.notes || null,
  };
}

function ClientFormFields({ form, setForm }: { form: ClientForm; setForm: (f: ClientForm) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Company name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Maerua Mall Management (Pty) Ltd" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Contact person</Label>
          <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            placeholder="e.g. J. Shikongo" />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+264 61 000 000" />
        </div>
        <div className="space-y-1.5">
          <Label>Billing email</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="accounts@client.com" />
        </div>
        <div className="space-y-1.5">
          <Label>VAT number</Label>
          <Input value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
            placeholder="Optional" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Payment terms (days)</Label>
          <Input type="number" min={0} value={form.payment_terms_days}
            onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
            placeholder="Company default" />
          <p className="text-xs text-muted-foreground">Days until invoices fall due. Leave blank to use the company default.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Billing address</Label>
          <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Street, City, Country" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Contract details, special instructions…" />
      </div>
    </div>
  );
}

function NewClientDialog({ open, onOpenChange, tenantId }: {
  open: boolean; onOpenChange: (v: boolean) => void; tenantId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);

  const create = useMutation({
    mutationFn: async () => {
      const row = toRow(form);
      const { error } = await supabase.from("clients").insert({ ...row, tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Client "${form.name.trim()}" registered.`);
      setForm(EMPTY_FORM);
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to register client"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register new client</DialogTitle>
          <DialogDescription>
            Capture the client when the contract is signed. Sites and invoices link back to this record.
          </DialogDescription>
        </DialogHeader>
        <ClientFormFields form={form} setForm={setForm} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name.trim()}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditClientDialog({ client, open, onOpenChange }: {
  client: Client; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClientForm>({
    name: client.name,
    contact_person: client.contact_person ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    vat_number: client.vat_number ?? "",
    payment_terms_days: client.payment_terms_days != null ? String(client.payment_terms_days) : "",
    address: client.address ?? "",
    notes: client.notes ?? "",
  });
  const [active, setActive] = useState(client.active);

  const save = useMutation({
    mutationFn: async () => {
      const row = toRow(form);
      const { error } = await supabase.from("clients").update({ ...row, active }).eq("id", client.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Client updated.");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit client — {client.name}</DialogTitle>
          <DialogDescription>Changes apply everywhere this client is referenced.</DialogDescription>
        </DialogHeader>
        <ClientFormFields form={form} setForm={setForm} />
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">Inactive clients are hidden from new-site and invoice dropdowns.</p>
          </div>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientRow({ client, canManage }: { client: Client; canManage: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <TableRow className={!client.active ? "opacity-60" : undefined}>
      <TableCell className="py-3">
        <div className="font-medium text-sm">{client.name}</div>
        {client.vat_number && <div className="text-xs text-muted-foreground">VAT {client.vat_number}</div>}
      </TableCell>
      <TableCell className="py-3 text-sm">
        <div>{client.contact_person ?? "—"}</div>
        <div className="text-xs text-muted-foreground flex flex-col gap-0.5 mt-0.5">
          {client.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{client.email}</span>}
          {client.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{client.phone}</span>}
        </div>
      </TableCell>
      <TableCell className="py-3">
        {client.sites.length === 0 ? (
          <span className="text-sm text-muted-foreground">No sites</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {client.sites.map((s) => (
              <Badge key={s.id} variant="secondary" className="font-normal">
                <MapPin className="mr-1 h-3 w-3" />{s.name}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 text-sm text-muted-foreground">
        {client.payment_terms_days != null ? `${client.payment_terms_days} days` : "Default"}
      </TableCell>
      <TableCell className="py-3">
        <Badge variant={client.active ? "default" : "outline"}>{client.active ? "Active" : "Inactive"}</Badge>
      </TableCell>
      <TableCell className="py-3 text-right">
        {canManage && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {editOpen && <EditClientDialog client={client} open={editOpen} onOpenChange={setEditOpen} />}
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function ClientsPage() {
  const { profile } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");

  const role = profile?.role;
  const canView = role === "admin" || role === "operations" || role === "accountant";
  const canManage = role === "admin" || role === "operations";

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["clients", profile?.tenant_id],
    enabled: !!profile?.tenant_id && canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, contact_person, email, phone, address, vat_number, payment_terms_days, notes, active, created_at, sites(id, name)")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Client[];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return clients;
    const q = search.toLowerCase();
    return clients.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.contact_person ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      c.sites.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [clients, search]);

  if (!canView) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <Briefcase className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Access restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">Clients are available to admin, operations and accountant roles.</p>
        </div>
      </div>
    );
  }

  const activeCount = clients.filter((c) => c.active).length;
  const totalSites = clients.reduce((s, c) => s + c.sites.length, 0);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-muted-foreground" /> Clients
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Companies you guard for. {activeCount} active · {totalSites} site{totalSites !== 1 ? "s" : ""} deployed.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Register client
          </Button>
        )}
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients, contacts, sites…" className="pl-9" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {clients.length === 0
                ? `No clients registered yet.${canManage ? ' Click "Register client" when a contract is signed.' : ""}`
                : "No clients match your search."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Client</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Sites</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => <ClientRow key={c.id} client={c} canManage={canManage} />)}
            </TableBody>
          </Table>
        </div>
      )}

      {profile?.tenant_id && (
        <NewClientDialog open={newOpen} onOpenChange={setNewOpen} tenantId={profile.tenant_id} />
      )}
    </div>
  );
}
