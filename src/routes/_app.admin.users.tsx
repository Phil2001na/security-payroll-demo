import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Loader2, UserPlus } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initials } from "@/lib/format";

export const Route = createFileRoute("/_app/admin/users")({
  component: SystemUsersPage,
  head: () => ({ meta: [{ title: "System users — Demo Payroll System" }] }),
});

type UserProfile = {
  id: string;
  full_name: string;
  email: string | null;
  role: "admin" | "accountant" | "payroll" | "operations" | "supervisor" | "security_supervisor" | "viewer";
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

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserProfile["role"] }) => {
      // profiles is update_own only under RLS — cross-user writes go through a
      // SECURITY DEFINER RPC.
      const { error } = await supabase.rpc("set_user_role", { p_user: userId, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({ queryKey: ["system-users"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users className="h-7 w-7 text-muted-foreground" /> System users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who can sign into the ERP. Supervisors only see data for sites you assign them.
          </p>
        </div>
        <AddUserDialog />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
          <CardDescription>
            Use <strong>Add user</strong> to create an account directly — they sign in with the email and temporary password you set. Roles: <strong>admin</strong> (full control + user management), <strong>accountant</strong> (finance/invoicing), <strong>payroll</strong> (scheduling/attendance/payroll), <strong>operations</strong> (full org access), <strong>supervisor</strong> (attendance-only, scoped to assigned sites — marks attendance for payroll to verify), or <strong>viewer</strong> (read-only). Assign a supervisor's sites from the site card on{" "}
            <Link to="/sites" className="underline underline-offset-2">Sites</Link>.
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
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : users?.map((u) => (
              <UserRow key={u.id}
                user={u}
                isSelf={u.id === profile?.id}
                onRoleChange={(role) => updateRole.mutate({ userId: u.id, role })}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const ROLE_OPTIONS: { value: UserProfile["role"]; label: string }[] = [
  { value: "viewer", label: "Viewer" },
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "payroll", label: "Payroll" },
  { value: "operations", label: "Operations" },
  { value: "security_supervisor", label: "Supervisor" },
];

function AddUserDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserProfile["role"]>("viewer");

  const reset = () => {
    setFirstName(""); setLastName(""); setEmail(""); setPassword(""); setRole("viewer");
  };

  const createUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { firstName, lastName, email, password, role },
      });
      // Edge function returns a JSON { error } body with a non-2xx status.
      if (error) {
        let msg = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch { /* keep default message */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success(`${firstName} ${lastName}`.trim() + " can now sign in with the password you set.");
      void queryClient.invalidateQueries({ queryKey: ["system-users"] });
      reset();
      setOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create user"),
  });

  const canSubmit = firstName.trim() && email.trim() && password.length >= 8 && !createUser.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><UserPlus className="mr-2 h-4 w-4" /> Add user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Creates an account in your organisation. The user signs in immediately with this email
            and temporary password — no email confirmation required.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) createUser.mutate(); }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="first-name">First name</Label>
              <Input id="first-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Surname</Label>
              <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-email">Email</Label>
            <Input id="new-email" type="email" required autoComplete="off"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input id="new-password" type="text" required minLength={8} autoComplete="off"
              placeholder="Min 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">Share this with the user. They can change it later.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserProfile["role"])}>
              <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">For supervisor roles, assign sites afterwards from the site card on the Sites page.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {createUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({
  user, isSelf, onRoleChange,
}: {
  user: UserProfile;
  isSelf: boolean;
  onRoleChange: (role: UserProfile["role"]) => void;
}) {
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
            <SelectItem value="security_supervisor">Supervisor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={user.is_active ? "border-success/40 text-success" : ""}>
          {user.is_active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
