import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

export function RoleOnboardingDialog() {
  const { profile, refresh } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!profile || profile.onboarding_complete) return null;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          onboarding_complete: true,
        })
        .eq("id", profile.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finish onboarding");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl mx-4">
        <div className="mb-5">
          <p className="font-display text-xl font-bold">Welcome to Demo Payroll System</p>
          <p className="text-sm text-muted-foreground mt-1">
            Your administrator has assigned your access. You can change your profile details later.
          </p>
        </div>

        <Button
          className="w-full mt-5"
          disabled={saving}
          onClick={handleConfirm}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </div>
    </div>
  );
}
