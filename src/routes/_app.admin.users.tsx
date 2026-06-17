import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Loader2 } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { initials } from "@/lib/format";

export const Route = createFileRoute("/_app/admin/users")({
  component: SystemUsersPage,
  head: () => ({ meta: [{ title: "System users — Demo Payroll System" }] }),
});

type UserProfile = {
  id: string;
  full_name: string;
  email: string | null;
  role: "admin" | "accountant" | "payroll" | "operations" | "supervisor" | "viewer";
  assigned_site_ids: string[];
  is_active: boolean;
};

function SystemUsersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  if (profile?.role !== "admin") {
    return <AccessDenied message="Only tenant admins can manage system users." />;
  }

  const { data: users, isLoading } = useQuery({
    queryKey: ["system-users", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, assigned_site_ids, is_active")
        .order("full_name");
      if (error) throw error;
      return data as UserProfile[];
    },
  });

  const { data: sites } = useQuery({
    queryKey: ["sites-list-admin", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserProfile["role"] }) => {
      const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const updateSites = useMutation({
    mutationFn: async ({ userId, siteIds }: { userId: string; siteIds: string[] }) => {
      const { error } = await supabase.from("profiles").update({ assigned_site_ids: siteIds }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site assignments updated");
      void queryClient.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
          <Users className="h-7 w-7 text-muted-foreground" /> System users
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage who can sign into the ERP. Supervisors only see data for sites you assign them.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inviting new users</CardTitle>
          <CardDescription>
            New users sign up themselves at the login screen and start as <Badge variant="outline" className="ml-1">viewer</Badge>.
            Promote them to <strong>accountant</strong> (finance/invoicing), <strong>payroll</strong> (scheduling/attendance/payroll), <strong>operations</strong> (full org access), or <strong>supervisor</strong> (scoped to assigned sites).
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Assigned sites</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : users?.map((u) => (
              <UserRow key={u.id}
                user={u}
                sites={sites ?? []}
                isSelf={u.id === profile?.id}
                onRoleChange={(role) => updateRole.mutate({ userId: u.id, role })}
                onSitesChange={(siteIds) => updateSites.mutate({ userId: u.id, siteIds })}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function UserRow({
  user, sites, isSelf, onRoleChange, onSitesChange,
}: {
  user: UserProfile;
  sites: { id: string; name: string }[];
  isSelf: boolean;
  onRoleChange: (role: UserProfile["role"]) => void;
  onSitesChange: (siteIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(user.assigned_site_ids);
  const [open, setOpen] = useState(false);

  const siteNames = useMemo(() => {
    const map = new Map(sites.map((s) => [s.id, s.name]));
    return user.assigned_site_ids.map((id) => map.get(id)).filter(Boolean) as string[];
  }, [sites, user.assigned_site_ids]);

  const supervisorScoped = user.role === "supervisor";

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-medium text-xs">
            {initials(user.full_name)}
          </div>
          <div>
            <div className="font-medium">{user.full_name} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm font-mono">{user.email}</TableCell>
      <TableCell>
        <Select
          value={user.role}
          onValueChange={(v) => onRoleChange(v as UserProfile["role"])}
          disabled={isSelf}
        >
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="accountant">Accountant</SelectItem>
            <SelectItem value="payroll">Payroll</SelectItem>
            <SelectItem value="operations">Operations</SelectItem>
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {supervisorScoped ? (
          <Popover open={open} onOpenChange={(o) => {
            setOpen(o);
            if (!o && JSON.stringify(selected.sort()) !== JSON.stringify([...user.assigned_site_ids].sort())) {
              onSitesChange(selected);
            }
          }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="font-normal">
                {siteNames.length > 0 ? `${siteNames.length} site${siteNames.length > 1 ? "s" : ""}` : "Assign sites"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <div className="max-h-72 overflow-y-auto p-2">
                {sites.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center p-4">No sites yet</p>
                ) : sites.map((s) => {
                  const checked = selected.includes(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={(c) => {
                        if (c) setSelected([...selected, s.id]);
                        else setSelected(selected.filter((id) => id !== s.id));
                      }} />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-xs text-muted-foreground">All sites</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={user.is_active ? "border-success/40 text-success" : ""}>
          {user.is_active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
