import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({
  // We can't synchronously check auth at the route level (client-side session
  // hydration happens in AuthProvider). beforeLoad runs on every navigation;
  // we use Supabase's getSession to short-circuit redirect when no token.
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { session, profile, loading, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/auth" });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
          <p className="text-sm font-medium">Setting up your workspace…</p>
          <p className="text-xs text-muted-foreground">
            If this takes more than a few seconds, try refreshing the page. If the problem persists,
            your account may not be linked to a company yet — contact your administrator.
          </p>
          <div className="flex gap-3">
            <button
              className="text-xs text-primary underline"
              onClick={() => { void refresh(); }}
            >
              Retry
            </button>
            <span className="text-xs text-muted-foreground">·</span>
            <button className="text-xs text-muted-foreground underline" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
