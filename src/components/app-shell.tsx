import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard, Users, MapPin, CalendarDays, ClipboardList,
  Calculator, ShieldAlert, Settings, LogOut, Menu, Shield, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/format";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Array<"admin" | "operations" | "supervisor" | "viewer">;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employees", label: "Employees", icon: Users },
  { to: "/sites", label: "Sites", icon: MapPin },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/attendance", label: "Attendance", icon: ClipboardList },
  { to: "/payroll", label: "Payroll", icon: Calculator },
  { to: "/disciplinary", label: "Disciplinary", icon: ShieldAlert },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "System Users", icon: Users, roles: ["admin"] },
  { to: "/admin/settings", label: "Admin Settings", icon: Settings, roles: ["admin"] },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

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
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
      {NAV.map(renderItem)}
      {isAdmin && (
        <>
          <div className="px-2 pt-5 pb-2 text-xs uppercase tracking-wider text-sidebar-foreground/50">
            Administration
          </div>
          {ADMIN_NAV.map(renderItem)}
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
        <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive">
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
        <div className="font-display text-sm font-bold text-sidebar-foreground leading-none">Dog Force</div>
        <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 mt-1">Payroll & Ops</div>
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
            <span className="font-display font-bold">Dog Force</span>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
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

        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
