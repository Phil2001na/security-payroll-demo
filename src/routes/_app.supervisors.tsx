import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCog, Loader2 } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteAssignPopover } from "@/components/site-assign-popover";
import { initials } from "@/lib/format";

export const Route = createFileRoute("/_app/supervisors")({
  component: SupervisorsPage,
  head: () => ({ meta: [{ title: "Supervisors — Demo Payroll System" }] }),
});

type Supervisor = {
  id: string;
  full_name: string;
  email: string | null;
  assigned_site_ids: string[] | null;
};

type SiteOption = {
  id: string;
  name: string;
};

function normalizeSiteIds(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function SupervisorsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const role = profile?.role;

  if (role && role !== "admin" && role !== "operations" && role !== "payroll") {
    return <AccessDenied message="Supervisor management is restricted to payroll and operations staff." />;
  }

  const { data: supervisors, isLoading } = useQuery({
    queryKey: ["security-supervisors", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, assigned_site_ids")
        .eq("role", "security_supervisor")
        .order("full_name");
      if (error) throw error;
      return data as Supervisor[];
    },
  });

  const { data: sites } = useQuery({
    queryKey: ["sites-list-supervisors", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return data as SiteOption[];
    },
  });

  const updateSites = useMutation({
    mutationFn: async ({ userId, siteIds }: { userId: string; siteIds: string[] }) => {
      const { error } = await supabase.rpc("set_user_sites", { p_user: userId, p_site_ids: siteIds });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site assignments updated");
      void queryClient.invalidateQueries({ queryKey: ["security-supervisors"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
          <UserCog className="h-7 w-7 text-muted-foreground" /> Supervisors
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign each supervisor the sites they cover. They can only mark
          attendance for guards at their assigned sites.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How this works</CardTitle>
          <CardDescription>
            Supervisors mark attendance when they pick up guards; their marks are
            submitted for you to verify under <strong>Approvals</strong> before they count
            toward payroll. An admin sets a user's role to <strong>Supervisor</strong>
            under System Users; assign their sites here or on the site itself.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supervisor</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Assigned sites</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : (supervisors?.length ?? 0) === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                No supervisors yet. An admin can set a user's role to "Supervisor" under System Users.
              </TableCell></TableRow>
            ) : supervisors?.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-medium text-xs">
                      {initials(u.full_name)}
                    </div>
                    <div className="font-medium">{u.full_name}</div>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-mono">{u.email}</TableCell>
                <TableCell>
                  <SiteAssignPopover
                    assignedSiteIds={normalizeSiteIds(u.assigned_site_ids)}
                    sites={sites ?? []}
                    onSave={(siteIds) => updateSites.mutate({ userId: u.id, siteIds })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
