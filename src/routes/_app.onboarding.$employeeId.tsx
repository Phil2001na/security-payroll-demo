import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, FileText, Upload, CheckCircle2, X } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/onboarding/$employeeId")({
  component: OnboardingPortal,
  head: () => ({ meta: [{ title: "Guard Onboarding — Dog Force" }] }),
});

function OnboardingPortal() {
  const { employeeId } = Route.useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const canSupervise = profile?.role === "admin" || profile?.role === "operations" || profile?.role === "supervisor";

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding", employeeId],
    queryFn: async () => {
      const [empRes, tenantRes, existingRes] = await Promise.all([
        supabase
          .from("employees")
          .select("id, surname, first_names, employee_code, position, home_site_id, tenant_id, sites:home_site_id(id, name, contract_terms_text)")
          .eq("id", employeeId)
          .maybeSingle(),
        supabase.from("tenants").select("default_contract_terms, name").maybeSingle(),
        supabase
          .from("signed_agreements")
          .select("id, signed_at")
          .eq("employee_id", employeeId)
          .order("signed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (empRes.error) throw empRes.error;
      if (tenantRes.error) throw tenantRes.error;
      return {
        employee: empRes.data,
        tenant: tenantRes.data,
        existing: existingRes.data,
      };
    },
  });

  const contractText = useMemo(() => {
    const site = data?.employee?.sites as { contract_terms_text?: string | null } | null;
    return site?.contract_terms_text?.trim() || data?.tenant?.default_contract_terms?.trim() || "";
  }, [data]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB)");
      return;
    }
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) {
      toast.error("Only JPG, PNG, WEBP or PDF allowed");
      return;
    }
    setIdFile(file);
  };

  const submit = async () => {
    if (!data?.employee) return;
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("Please capture the guard's signature");
      return;
    }
    if (!idFile) {
      toast.error("Please upload a certified ID copy");
      return;
    }
    if (!acknowledged) {
      toast.error("Confirm the guard has read and agreed to the contract");
      return;
    }
    if (!contractText) {
      toast.error("No contract text configured for this site or tenant");
      return;
    }

    setSubmitting(true);
    try {
      const sigDataUrl = sigRef.current.getCanvas().toDataURL("image/png");
      const sigBlob = await (await fetch(sigDataUrl)).blob();
      const ts = Date.now();
      const sigPath = `${employeeId}/signature-${ts}.png`;
      const idExt = idFile.name.split(".").pop()?.toLowerCase() ?? "bin";
      const idPath = `${employeeId}/id-${ts}.${idExt}`;

      const sigUp = await supabase.storage.from("onboarding").upload(sigPath, sigBlob, {
        contentType: "image/png",
        upsert: false,
      });
      if (sigUp.error) throw sigUp.error;

      const idUp = await supabase.storage.from("onboarding").upload(idPath, idFile, {
        contentType: idFile.type,
        upsert: false,
      });
      if (idUp.error) throw idUp.error;

      const { error: insErr } = await supabase.from("signed_agreements").insert({
        tenant_id: data.employee.tenant_id,
        employee_id: data.employee.id,
        site_id: data.employee.home_site_id,
        contract_snapshot: contractText,
        signature_url: sigPath,
        id_document_url: idPath,
        signed_by_supervisor: profile?.id ?? null,
      });
      if (insErr) throw insErr;

      toast.success("Onboarding complete — agreement saved");
      void navigate({ to: "/employees/$employeeId", params: { employeeId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data?.employee) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <p className="text-muted-foreground">Employee not found.</p>
        <Button asChild className="mt-4"><Link to="/employees">Back</Link></Button>
      </div>
    );
  }
  if (!canSupervise) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <p className="text-muted-foreground">Only admins, operations or supervisors can run onboarding.</p>
      </div>
    );
  }

  const emp = data.employee;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link to="/employees/$employeeId" params={{ employeeId }}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to employee
        </Link>
      </Button>

      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Guard Onboarding Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {emp.surname}, {emp.first_names} · <span className="font-mono">{emp.employee_code}</span>
          {data.existing && (
            <Badge variant="secondary" className="ml-2">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Previously signed
            </Badge>
          )}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Employment Contract
          </CardTitle>
          <CardDescription>
            {(emp.sites as { name?: string } | null)?.name
              ? `Site-specific terms for ${(emp.sites as { name: string }).name}`
              : "Tenant default terms"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contractText ? (
            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {contractText}
            </div>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              No contract text configured. Set a default in Tenant settings or per-site terms before onboarding.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certified ID Copy</CardTitle>
          <CardDescription>JPG, PNG, WEBP or PDF · max 10 MB · stored privately</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`rounded-md border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            {idFile ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  <span className="truncate">{idFile.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {(idFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setIdFile(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  Drop file here or click to browse
                </p>
                <input
                  id="id-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <Button variant="outline" size="sm" asChild>
                  <label htmlFor="id-upload" className="cursor-pointer">Choose file</label>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Guard Signature</CardTitle>
          <CardDescription>Sign with finger or stylus on the pad below</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-background overflow-hidden">
            <SignatureCanvas
              ref={(r) => { sigRef.current = r; }}
              penColor="#0f172a"
              canvasProps={{
                className: "w-full h-48 touch-none",
              }}
            />
          </div>
          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>
              Clear signature
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Guard confirms reading & agreeing to the contract</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 sticky bottom-4">
        <Button
          size="lg"
          onClick={() => void submit()}
          disabled={submitting || !contractText}
          className="shadow-lg"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit signed agreement
        </Button>
      </div>
    </div>
  );
}
