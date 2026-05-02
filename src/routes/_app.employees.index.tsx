import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Upload, Download, Users as UsersIcon, Shield, Briefcase, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatNAD, initials } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_app/employees/")({
  component: EmployeesPage,
  head: () => ({ meta: [{ title: "Employees — Dog Force Payroll" }] }),
});

type EmployeeRow = {
  id: string;
  employee_code: string;
  surname: string;
  first_names: string;
  display_name: string | null;
  position: string;
  category: string;
  status: string;
  hourly_rate: number;
  monthly_salary: number;
  transport_allowance: number;
  phone: string | null;
  email: string | null;
  home_site_id: string | null;
  national_id: string | null;
  union_member: boolean;
  ordinarily_works_sundays: boolean;
  start_date: string | null;
  contract_signed_at: string | null;
  sites: { name: string } | null;
};

type GroupTab = "officers" | "management";

function EmployeesPage() {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [contractFilter, setContractFilter] = useState<"all" | "signed" | "pending">("all");
  const [tab, setTab] = useState<GroupTab>("officers");

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select(`
          id, employee_code, surname, first_names, display_name,
          position, category, status, hourly_rate, monthly_salary, transport_allowance,
          phone, email, home_site_id, national_id, union_member,
          ordinarily_works_sundays, start_date, contract_signed_at,
          sites:home_site_id ( name )
        `)
        .order("surname", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data as unknown as EmployeeRow[];
    },
  });

  const counts = useMemo(() => {
    const officers = employees?.filter((e) => e.category === "officer").length ?? 0;
    const management = employees?.filter((e) => e.category === "management").length ?? 0;
    return { officers, management };
  }, [employees]);

  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (e.category !== tab.replace(/s$/, "")) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (contractFilter === "signed" && !e.contract_signed_at) return false;
      if (contractFilter === "pending" && e.contract_signed_at) return false;
      if (!q) return true;
      const name = `${e.first_names} ${e.surname}`.toLowerCase();
      return (
        name.includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        (e.national_id ?? "").toLowerCase().includes(q) ||
        (e.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, search, statusFilter, contractFilter, tab]);

  const pendingCount = useMemo(
    () => employees?.filter((e) => !e.contract_signed_at && e.status === "active").length ?? 0,
    [employees],
  );

  const handleExport = () => {
    if (!filtered.length) {
      toast.error("Nothing to export");
      return;
    }
    downloadCsv(
      `employees-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((e) => ({
        employee_code: e.employee_code,
        surname: e.surname,
        first_names: e.first_names,
        national_id: e.national_id ?? "",
        position: e.position,
        category: e.category,
        status: e.status,
        hourly_rate: e.hourly_rate,
        transport_allowance: e.transport_allowance,
        phone: e.phone ?? "",
        email: e.email ?? "",
        home_site: e.sites?.name ?? "",
        union_member: e.union_member,
        ordinarily_works_sundays: e.ordinarily_works_sundays,
        start_date: e.start_date ?? "",
      })),
    );
    toast.success(`Exported ${filtered.length} employees`);
  };

  const canManage = profile?.role === "admin" || profile?.role === "operations";

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
            <UsersIcon className="h-7 w-7 text-muted-foreground" />
            Employees
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage guards, supervisors, and management.{" "}
            {employees && <span className="font-mono">{employees.length} total</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to="/employees/import"><Upload className="mr-2 h-4 w-4" /> Import</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/employees/new"><Plus className="mr-2 h-4 w-4" /> Add employee</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as GroupTab)}>
        <TabsList>
          <TabsTrigger value="officers" className="gap-2">
            <Shield className="h-4 w-4" /> Officers
            <Badge variant="secondary" className="ml-1 font-mono">{counts.officers}</Badge>
          </TabsTrigger>
          <TabsTrigger value="management" className="gap-2">
            <Briefcase className="h-4 w-4" /> Management
            <Badge variant="secondary" className="ml-1 font-mono">{counts.management}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, ID, phone…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={contractFilter} onValueChange={(v) => setContractFilter(v as typeof contractFilter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contracts</SelectItem>
            <SelectItem value="pending">Contract pending{pendingCount ? ` (${pendingCount})` : ""}</SelectItem>
            <SelectItem value="signed">Contract signed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>{tab === "officers" ? "Home site" : "Role"}</TableHead>
              <TableHead className="text-right">{tab === "officers" ? "Hourly" : "Monthly salary"}</TableHead>
              <TableHead className="text-right">Transport</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  {employees?.length === 0 ? (
                    <>No employees yet. {canManage && (
                      <Link to="/employees/new" className="text-primary underline underline-offset-4">Add your first employee</Link>
                    )} or <Link to="/employees/import" className="text-primary underline underline-offset-4">import a CSV</Link>.</>
                  ) : (
                    `No ${tab} match your filters.`
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => (
                <TableRow key={e.id} className="hover:bg-muted/40">
                  <TableCell>
                    <Link to="/employees/$employeeId" params={{ employeeId: e.id }} className="flex items-center gap-3 group">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-medium text-xs">
                        {initials(`${e.first_names} ${e.surname}`)}
                      </div>
                      <div>
                        <div className="font-medium group-hover:text-primary transition-colors">
                          {e.surname}, {e.first_names}
                        </div>
                        {e.phone && <div className="text-xs text-muted-foreground font-mono">{e.phone}</div>}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{e.employee_code}</TableCell>
                  <TableCell className="capitalize text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      {e.position === "driver" && <Truck className="h-3.5 w-3.5 text-muted-foreground" />}
                      {e.position === "security_officer" && <Shield className="h-3.5 w-3.5 text-muted-foreground" />}
                      {e.position.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {tab === "officers"
                      ? (e.sites?.name ?? <span className="text-muted-foreground">—</span>)
                      : <span className="capitalize">{e.position.replace(/_/g, " ")}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {tab === "officers"
                      ? `${formatNAD(e.hourly_rate)}/hr`
                      : formatNAD(e.monthly_salary || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatNAD(e.transport_allowance)}</TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    active: { className: "bg-success/15 text-success border-success/30", label: "Active" },
    suspended: { className: "bg-warning/15 text-warning border-warning/40", label: "Suspended" },
    terminated: { className: "bg-destructive/15 text-destructive border-destructive/30", label: "Terminated" },
  };
  const v = variants[status] ?? { className: "", label: status };
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}
