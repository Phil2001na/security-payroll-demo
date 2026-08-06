import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  MapPin,
  CalendarDays,
  CalendarOff,
  ClipboardList,
  ClipboardCheck,
  Calculator,
  ShieldAlert,
  Settings,
  LogOut,
  Menu,
  Shield,
  ChevronDown,
  Sparkles,
  BrainCircuit,
  BookOpen,
  Receipt,
  Briefcase,
  UserCog,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { RoleOnboardingDialog } from "@/components/role-onboarding-dialog";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AppRole =
  | "admin"
  | "accountant"
  | "operations"
  | "supervisor"
  | "viewer"
  | "payroll"
  | "security_supervisor";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: AppRole[];
  ceoVisible?: boolean;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/wizard", label: "Getting Started", icon: Sparkles, roles: ["admin", "operations"] },
  {
    to: "/employees",
    label: "Employees",
    icon: Users,
    roles: ["admin", "operations", "supervisor", "payroll", "security_supervisor"],
  },
  {
    to: "/clients",
    label: "Clients",
    icon: Briefcase,
    roles: ["admin", "operations"],
    ceoVisible: true,
  },
  {
    to: "/sites",
    label: "Sites",
    icon: MapPin,
    roles: ["admin", "operations", "supervisor", "payroll"],
  },
  {
    to: "/schedule",
    label: "Schedule",
    icon: CalendarDays,
    roles: ["admin", "operations", "supervisor", "payroll"],
  },
  {
    to: "/attendance",
    label: "Attendance",
    icon: ClipboardList,
    roles: ["admin", "operations", "supervisor", "payroll", "security_supervisor"],
  },
  {
    to: "/leave",
    label: "Leave",
    icon: CalendarOff,
    roles: ["admin", "operations", "supervisor", "payroll", "security_supervisor"],
  },
  {
    to: "/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    roles: ["admin", "operations", "payroll"],
  },
  { to: "/payroll", label: "Payroll", icon: Calculator, roles: ["admin", "operations", "payroll"] },
  {
    to: "/supervisors",
    label: "Supervisors",
    icon: UserCog,
    roles: ["admin", "operations", "payroll"],
  },
  {
    to: "/disciplinary",
    label: "Disciplinary",
    icon: ShieldAlert,
    roles: ["admin", "operations", "supervisor", "payroll"],
  },
  {
    to: "/equipment",
    label: "Equipment",
    icon: Boxes,
    roles: ["admin", "operations", "supervisor", "payroll", "viewer", "accountant"],
  },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "System Users", icon: Users },
  { to: "/admin/settings", label: "Admin Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { profile } = useAuth();
  const role = profile?.role as AppRole | undefined;
  const isCeo = profile?.is_ceo_executive === true;
  const canUseAi = isCeo || role === "admin";
  const isAdmin = role === "admin" && !isCeo;

  // Security supervisors handle daily muster and can submit leave for guards at their
  // assigned sites; they cannot approve leave or assign relief coverage.
  const attendanceOnly = role === "security_supervisor";
  const canSeeAccounting = !attendanceOnly && (role === "admin" || role === "accountant" || isCeo);
  const canSeeInvoices = !attendanceOnly && (role === "admin" || role === "accountant");

  const visibleNav = NAV.filter((item) => {
    if (attendanceOnly) return item.to === "/attendance" || item.to === "/leave";
    if (!item.roles) return true;
    if (isCeo) return item.ceoVisible === true;
    return role ? item.roles.includes(role) : false;
  });

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-1 px-3">
      <div className="px-2 pt-3 pb-2 text-xs uppercase tracking-wider text-sidebar-foreground/50">
        Operations
      </div>
      {visibleNav.map(renderItem)}
      {canUseAi && (
        <>
          <div className="px-2 pt-5 pb-2 text-xs uppercase tracking-wider text-sidebar-foreground/50">
            Executive
          </div>
          {renderItem({ to: "/ai-assistant", label: "AI Assistant", icon: BrainCircuit })}
        </>
      )}
      {(canSeeAccounting || canSeeInvoices) && (
        <>
          <div className="px-2 pt-5 pb-2 text-xs uppercase tracking-wider text-sidebar-foreground/50">
            Finance
          </div>
          {canSeeAccounting &&
            renderItem({ to: "/accounting", label: "Accounting", icon: BookOpen })}
          {canSeeInvoices && renderItem({ to: "/invoices", label: "Invoices", icon: Receipt })}
        </>
      )}
      {(isAdmin || isCeo) && (
        <>
          <div className="px-2 pt-5 pb-2 text-xs uppercase tracking-wider text-sidebar-foreground/50">
            Administration
          </div>
          {/* Full admins get the whole admin nav; CEOs get Settings only (System
              Users management stays an admin-only task). */}
          {ADMIN_NAV.filter((item) => isAdmin || item.to === "/admin/settings").map(renderItem)}
        </>
      )}
    </nav>
  );
}

function UserMenu() {
  const { profile, user, signOut } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md p-2 hover:bg-sidebar-accent transition-colors">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
            {initials(profile?.full_name)}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium text-sidebar-foreground truncate">
              {profile?.full_name ?? user?.email ?? "User"}
            </div>
            <div className="text-xs text-sidebar-foreground/60 truncate capitalize">
              {profile?.role ?? "—"}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-sidebar-foreground/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel>
          <div className="text-sm font-medium">{profile?.full_name}</div>
          <div className="text-xs font-normal text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void signOut()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarBrand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <Shield className="h-5 w-5" />
      </div>
      <div>
        <div className="font-display text-sm font-bold text-sidebar-foreground leading-none">
          Demo Payroll
        </div>
        <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 mt-1">
          Payroll & Ops
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <SidebarBrand />
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks />
        </div>
        <div className="p-3 border-t border-sidebar-border">
          <UserMenu />
        </div>
      </aside>

      {/* Mobile header + sheet */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <span className="font-display font-bold">Demo Payroll</span>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBrand />
              <div className="py-3">
                <NavLinks onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-sidebar-border bg-sidebar">
                <UserMenu />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
        <RoleOnboardingDialog />
      </div>
    </div>
  );
}
