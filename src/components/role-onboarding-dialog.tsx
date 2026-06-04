import { useState } from "react";
import { BrainCircuit, Shield, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RoleChoice = "ceo" | "admin" | "staff";

const CHOICES: {
  id: RoleChoice;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}[] = [
  {
    id: "ceo",
    icon: BrainCircuit,
    label: "CEO / Executive",
    description: "Full system access plus AI Executive Assistant",
  },
  {
    id: "admin",
    icon: Shield,
    label: "Administrator",
    description: "Full system access and user management",
  },
  {
    id: "staff",
    icon: Users,
    label: "Staff",
    description: "Standard operational access based on assigned role",
  },
];

export function RoleOnboardingDialog() {
  const { profile, refresh } = useAuth();
  const [selected, setSelected] = useState<RoleChoice | null>(null);
  const [saving, setSaving] = useState(false);

  if (!profile || profile.onboarding_complete) return null;

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          onboarding_complete: true,
          role: selected === "staff" ? "viewer" : "admin",
          is_ceo_executive: selected === "ceo",
        })
        .eq("id", profile.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save role");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl mx-4">
        <div className="mb-5">
          <p className="font-display text-xl font-bold">Welcome to Demo Payroll System</p>
          <p className="text-sm text-muted-foreground mt-1">
            Select your access level to get started.
          </p>
        </div>

        <div className="space-y-3">
          {CHOICES.map(({ id, icon: Icon, label, description }) => (
            <button
              key={id}
              onClick={() => setSelected(id)}
              className={cn(
                "w-full text-left rounded-lg border p-4 transition-colors",
                selected === id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    selected === id ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <Button
          className="w-full mt-5"
          disabled={!selected || saving}
          onClick={handleConfirm}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </div>
    </div>
  );
}
