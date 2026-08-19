import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Shield, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
  head: () => ({
    meta: [{ title: "Sign in — Demo Payroll System" }],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = useSearch({ from: "/auth" });
  // TanStack resolves internal routes, but keep user-provided search state on a
  // strict internal-path allowlist as defense in depth.
  const safeRedirect = redirectTo?.startsWith("/") && !redirectTo.startsWith("//")
    ? redirectTo
    : "/dashboard";
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: safeRedirect });
    }
  }, [session, loading, navigate, safeRedirect]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevBypass = async () => {
    setSubmitting(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: "demo@payroll.dev",
        password: "Demo1234!",
      });
      if (!signInErr) return;
      const { error: signUpErr } = await supabase.auth.signUp({
        email: "demo@payroll.dev",
        password: "Demo1234!",
        options: { data: { full_name: "Demo User" } },
      });
      if (signUpErr) throw signUpErr;
      await supabase.auth.signInWithPassword({ email: "demo@payroll.dev", password: "Demo1234!" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dev login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-sidebar text-sidebar-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <div className="font-display text-lg font-bold leading-none">Demo Payroll</div>
            <div className="text-xs text-sidebar-foreground/60 mt-1">Management System</div>
          </div>
        </div>
        <div className="relative z-10 space-y-6">
          <h1 className="font-display text-4xl font-bold leading-tight">
            Payroll, scheduling, and compliance — built for security services.
          </h1>
          <p className="text-sidebar-foreground/70 max-w-md">
            Compliance-ready. Tax calculations handled. Site-scoped supervision and complete audit trail.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-md pt-4">
            {[
              { label: "Min wage", value: "N$16.00/hr" },
              { label: "SSC rate", value: "0.9%" },
              { label: "OT cap", value: "70 hrs/wk" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-sidebar-border/50 bg-sidebar-accent/30 p-3">
                <div className="text-xs text-sidebar-foreground/60">{s.label}</div>
                <div className="font-mono text-sm font-semibold mt-1">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs text-sidebar-foreground/50">
          © {new Date().getFullYear()} Demo Payroll System
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div className="font-display text-lg font-bold">Demo Payroll</div>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Sign in to your account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Welcome back. Enter your credentials to continue.
            </p>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-in">Email</Label>
              <Input id="email-in" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-in">Password</Label>
              <Input id="password-in" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            No account? Ask your administrator to create one for you.
          </p>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={submitting}>
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </Button>

          {import.meta.env.DEV && (
            <Button type="button" variant="secondary" className="w-full" onClick={handleDevBypass} disabled={submitting}>
              <Zap className="mr-2 h-4 w-4" />
              Dev — enter as demo user
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
