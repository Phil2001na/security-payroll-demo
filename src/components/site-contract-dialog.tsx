import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function SiteContractDialog({
  siteId,
  siteName,
  canManage,
}: {
  siteId: string;
  siteName: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["site-contract", siteId],
    enabled: open,
    queryFn: async () => {
      const [siteRes, tenantRes] = await Promise.all([
        supabase.from("sites").select("contract_terms_text").eq("id", siteId).maybeSingle(),
        supabase.from("tenants").select("default_contract_terms").maybeSingle(),
      ]);
      if (siteRes.error) throw siteRes.error;
      if (tenantRes.error) throw tenantRes.error;
      const current = siteRes.data?.contract_terms_text ?? "";
      setText(current);
      return {
        siteText: current,
        tenantDefault: tenantRes.data?.default_contract_terms ?? "",
      };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sites")
        .update({ contract_terms_text: text.trim() || null })
        .eq("id", siteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contract terms saved");
      void queryClient.invalidateQueries({ queryKey: ["site-contract", siteId] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <FileText className="mr-2 h-4 w-4" /> Contract terms
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Contract terms — {siteName}</DialogTitle>
          <DialogDescription>
            Site-specific terms shown to guards during onboarding. Leave blank to use the tenant default.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={data?.tenantDefault ? "(Tenant default in use — type here to override for this site)" : "Enter contract terms…"}
              className="min-h-[280px] font-mono text-xs"
              disabled={!canManage}
            />
            {!text.trim() && data?.tenantDefault && (
              <p className="text-xs text-muted-foreground">
                Falling back to tenant default ({data.tenantDefault.length} chars).
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          {canManage && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
