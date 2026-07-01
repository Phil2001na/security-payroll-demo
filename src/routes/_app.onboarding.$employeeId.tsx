import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, FileText, Upload, CheckCircle2, X, Download, FileSignature, AlertCircle,
} from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  generateContractPdf, mergeTemplate, templateForPosition, pickTemplate,
  type ContractEmployee, type ContractTenant,
} from "@/lib/contract-pdf";

export const Route = createFileRoute("/_app/onboarding/$employeeId")({
  component: OnboardingPortal,
  head: () => ({ meta: [{ title: "Contract — Demo Payroll System" }] }),
});

function OnboardingPortal() {
  const { employeeId } = Route.useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [signedPdf, setSignedPdf] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [mode, setMode] = useState<"upload" | "sign">("upload");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canSupervise = profile?.role === "admin" || profile?.role === "operations" || profile?.role === "supervisor" || profile?.role === "payroll";

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding", employeeId],
    queryFn: async () => {
      const [empRes, tenantRes, existingRes] = await Promise.all([
        supabase
          .from("employees")
          .select(
            "id, surname, first_names, employee_code, position, hourly_rate, monthly_salary, transport_allowance, national_id, start_date, home_site_id, tenant_id, contract_signed_at, contract_signed_pdf_url, sites:home_site_id(id, name)"
          )
          .eq("id", employeeId)
          .maybeSingle(),
        supabase
          .from("tenants")
          .select("name, legal_name, contract_template_officer, contract_template_driver, contract_template_management")
          .maybeSingle(),
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
      return { employee: empRes.data, tenant: tenantRes.data, existing: existingRes.data };
    },
  });

  const kind = useMemo(
    () => (data?.employee ? templateForPosition(data.employee.position) : "officer"),
    [data],
  );

  const template = useMemo(() => {
    if (!data?.tenant) return "";
    return pickTemplate(
      {
        officer: data.tenant.contract_template_officer,
        driver: data.tenant.contract_template_driver,
        management: data.tenant.contract_template_management,
      },
      kind,
    );
  }, [data, kind]);

  const contractEmployee: ContractEmployee | null = useMemo(() => {
    const e = data?.employee;
    if (!e) return null;
    return {
      surname: e.surname,
      first_names: e.first_names,
      employee_code: e.employee_code,
      national_id: e.national_id,
      position: e.position,
      hourly_rate: Number(e.hourly_rate),
      monthly_salary: Number(e.monthly_salary),
      transport_allowance: Number(e.transport_allowance),
      start_date: e.start_date,
      home_site_name: (e.sites as { name?: string } | null)?.name ?? null,
    };
  }, [data]);

  const contractTenant: ContractTenant | null = useMemo(() => {
    if (!data?.tenant) return null;
    return { name: data.tenant.name, legal_name: data.tenant.legal_name };
  }, [data]);

  const mergedPreview = useMemo(() => {
    if (!template || !contractEmployee || !contractTenant) return "";
    return mergeTemplate(template, contractEmployee, contractTenant);
  }, [template, contractEmployee, contractTenant]);

  useEffect(() => {
    const path = data?.employee?.contract_signed_pdf_url;
    if (!path) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: signed } = await supabase.storage
        .from("onboarding")
        .createSignedUrl(path, 60 * 10);
      if (!cancelled) setPreviewUrl(signed?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [data?.employee?.contract_signed_pdf_url]);

  const handleDownload = () => {
    if (!template || !contractEmployee || !contractTenant) {
      toast.error("Set up a contract template for this position in Admin → Settings first");
      return;
    }
    const { blob, fileName } = generateContractPdf({
      template, kind, employee: contractEmployee, tenant: contractTenant,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePdf = (file: File | null) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast.error("PDF too large (max 15MB)"); return; }
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF"); return; }
    setSignedPdf(file);
  };

  const handleId = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large (max 10MB)"); return; }
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) {
      toast.error("Only JPG, PNG, WEBP or PDF allowed"); return;
    }
    setIdFile(file);
  };

  const submitUploadFlow = async () => {
    if (!data?.employee || !contractEmployee || !contractTenant) return;
    if (!template) { toast.error("No contract template configured for this position"); return; }
    if (!signedPdf) { toast.error("Upload the signed contract PDF"); return; }
    if (!idFile) { toast.error("Upload the certified ID copy"); return; }

    setSubmitting(true);
    try {
      const ts = Date.now();
      const pdfPath = `${employeeId}/contract-signed-${ts}.pdf`;
      const idExt = idFile.name.split(".").pop()?.toLowerCase() ?? "bin";
      const idPath = `${employeeId}/id-${ts}.${idExt}`;

      const pdfUp = await supabase.storage.from("onboarding").upload(pdfPath, signedPdf, {
        contentType: "application/pdf", upsert: false,
      });
      if (pdfUp.error) throw pdfUp.error;

      const idUp = await supabase.storage.from("onboarding").upload(idPath, idFile, {
        contentType: idFile.type, upsert: false,
      });
      if (idUp.error) throw idUp.error;

      const { error: insErr } = await supabase.from("signed_agreements").insert({
        tenant_id: data.employee.tenant_id,
        employee_id: data.employee.id,
        site_id: data.employee.home_site_id,
        contract_snapshot: mergedPreview,
        signature_url: pdfPath, // wet signature lives inside the uploaded PDF
        id_document_url: idPath,
        signed_by_supervisor: profile?.id ?? null,
      });
      if (insErr) throw insErr;

      const { error: empErr } = await supabase.from("employees")
        .update({
          contract_signed_at: new Date().toISOString(),
          contract_signed_pdf_url: pdfPath,
          contract_template_kind: kind,
        })
        .eq("id", data.employee.id);
      if (empErr) throw empErr;

      toast.success("Signed contract saved");
      void qc.invalidateQueries({ queryKey: ["onboarding", employeeId] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void navigate({ to: "/employees/$employeeId", params: { employeeId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setSubmitting(false); }
  };

  const submitSignFlow = async () => {
    if (!data?.employee || !contractEmployee || !contractTenant) return;
    if (!template) { toast.error("No contract template configured for this position"); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { toast.error("Capture the guard's signature"); return; }
    if (!idFile) { toast.error("Upload the certified ID copy"); return; }
    if (!acknowledged) { toast.error("Confirm the guard has read & agreed"); return; }

    setSubmitting(true);
    try {
      const sigDataUrl = sigRef.current.getCanvas().toDataURL("image/png");
      const sigBlob = await (await fetch(sigDataUrl)).blob();
      const ts = Date.now();
      const sigPath = `${employeeId}/signature-${ts}.png`;
      const idExt = idFile.name.split(".").pop()?.toLowerCase() ?? "bin";
      const idPath = `${employeeId}/id-${ts}.${idExt}`;

      // Generate the contract PDF locally with the captured signature drawn onto
      // the employee signature line, and store it as the signed artifact.
      const { blob: pdfBlob } = generateContractPdf({
        template, kind, employee: contractEmployee, tenant: contractTenant,
        signatureDataUrl: sigDataUrl,
        signedDate: new Date().toISOString().slice(0, 10),
      });
      const pdfPath = `${employeeId}/contract-${ts}.pdf`;

      const sigUp = await supabase.storage.from("onboarding").upload(sigPath, sigBlob, {
        contentType: "image/png", upsert: false,
      });
      if (sigUp.error) throw sigUp.error;

      const idUp = await supabase.storage.from("onboarding").upload(idPath, idFile, {
        contentType: idFile.type, upsert: false,
      });
      if (idUp.error) throw idUp.error;

      const pdfUp = await supabase.storage.from("onboarding").upload(pdfPath, pdfBlob, {
        contentType: "application/pdf", upsert: false,
      });
      if (pdfUp.error) throw pdfUp.error;

      const { error: insErr } = await supabase.from("signed_agreements").insert({
        tenant_id: data.employee.tenant_id,
        employee_id: data.employee.id,
        site_id: data.employee.home_site_id,
        contract_snapshot: mergedPreview,
        signature_url: sigPath,
        id_document_url: idPath,
        signed_by_supervisor: profile?.id ?? null,
      });
      if (insErr) throw insErr;

      const { error: empErr } = await supabase.from("employees")
        .update({
          contract_signed_at: new Date().toISOString(),
          contract_signed_pdf_url: pdfPath,
          contract_template_kind: kind,
        })
        .eq("id", data.employee.id);
      if (empErr) throw empErr;

      toast.success("Onboarding complete — agreement saved");
      void qc.invalidateQueries({ queryKey: ["onboarding", employeeId] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void navigate({ to: "/employees/$employeeId", params: { employeeId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setSubmitting(false); }
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
        <p className="text-muted-foreground">Only admins, operations, supervisors or payroll can manage contracts.</p>
      </div>
    );
  }

  const emp = data.employee;
  const alreadySigned = !!emp.contract_signed_at;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link to="/employees/$employeeId" params={{ employeeId }}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to employee
        </Link>
      </Button>

      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Employment Contract</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {emp.surname}, {emp.first_names} · <span className="font-mono">{emp.employee_code}</span>{" "}
          · <span className="capitalize">{kind}</span> template
          {alreadySigned ? (
            <Badge variant="secondary" className="ml-2">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Signed {new Date(emp.contract_signed_at!).toLocaleDateString()}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-2 border-warning/40 text-warning">
              <AlertCircle className="mr-1 h-3 w-3" /> Contract pending
            </Badge>
          )}
        </p>
      </header>

      {!template && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            No contract template configured for the <strong>{kind}</strong> category.{" "}
            <Link to="/admin/settings" className="text-primary underline underline-offset-4">
              Set one up in Admin → Settings
            </Link>.
          </CardContent>
        </Card>
      )}

      {alreadySigned && previewUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" /> Current signed contract
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" /> View / download signed PDF
              </a>
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              You can replace it below by uploading a new signed copy or capturing a fresh signature.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Contract preview
          </CardTitle>
          <CardDescription>
            Merged with this employee's details. Download the PDF and let the guard read it before signing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mergedPreview ? (
            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {mergedPreview}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No template configured.</p>
          )}
          <Button onClick={handleDownload} disabled={!template} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> Download contract PDF
          </Button>
        </CardContent>
      </Card>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "upload" | "sign")}>
        <TabsList className="grid grid-cols-2 max-w-md">
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" /> Upload signed PDF
          </TabsTrigger>
          <TabsTrigger value="sign" className="gap-2">
            <FileSignature className="h-4 w-4" /> Sign on screen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Signed contract PDF</CardTitle>
              <CardDescription>The downloaded PDF, signed by the guard, scanned or photographed back as a PDF.</CardDescription>
            </CardHeader>
            <CardContent>
              <Dropzone
                file={signedPdf}
                onFile={handlePdf}
                dragOver={pdfDragOver}
                setDragOver={setPdfDragOver}
                accept="application/pdf"
                hint="PDF · max 15 MB"
                inputId="signed-pdf"
                clear={() => setSignedPdf(null)}
              />
            </CardContent>
          </Card>

          <IdCard idFile={idFile} onFile={handleId} dragOver={dragOver} setDragOver={setDragOver} clear={() => setIdFile(null)} />

          <div className="flex justify-end sticky bottom-4">
            <Button size="lg" onClick={() => void submitUploadFlow()} disabled={submitting || !template} className="shadow-lg">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save signed contract
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="sign" className="space-y-4 mt-4">
          <IdCard idFile={idFile} onFile={handleId} dragOver={dragOver} setDragOver={setDragOver} clear={() => setIdFile(null)} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Guard signature</CardTitle>
              <CardDescription>Sign with finger or stylus. We'll attach the signature to the auto-generated contract PDF.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border bg-background overflow-hidden">
                <SignatureCanvas
                  ref={(r) => { sigRef.current = r; }}
                  penColor="#0f172a"
                  canvasProps={{ className: "w-full h-48 touch-none" }}
                />
              </div>
              <div className="flex justify-between items-center">
                <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>Clear signature</Button>
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

          <div className="flex justify-end sticky bottom-4">
            <Button size="lg" onClick={() => void submitSignFlow()} disabled={submitting || !template} className="shadow-lg">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit signed agreement
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IdCard({
  idFile, onFile, dragOver, setDragOver, clear,
}: {
  idFile: File | null;
  onFile: (f: File | null) => void;
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  clear: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Certified ID copy</CardTitle>
        <CardDescription>JPG, PNG, WEBP or PDF · max 10 MB · stored privately</CardDescription>
      </CardHeader>
      <CardContent>
        <Dropzone
          file={idFile}
          onFile={onFile}
          dragOver={dragOver}
          setDragOver={setDragOver}
          accept="image/jpeg,image/png,image/webp,application/pdf"
          hint="JPG, PNG, WEBP or PDF"
          inputId="id-upload"
          clear={clear}
        />
      </CardContent>
    </Card>
  );
}

function Dropzone({
  file, onFile, dragOver, setDragOver, accept, hint, inputId, clear,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  accept: string;
  hint: string;
  inputId: string;
  clear: () => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] ?? null); }}
      className={`rounded-md border-2 border-dashed p-6 text-center transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      {file ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            <span className="truncate">{file.name}</span>
            <span className="text-muted-foreground font-mono text-xs">{(file.size / 1024).toFixed(0)} KB</span>
          </div>
          <Button variant="ghost" size="sm" onClick={clear}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <>
          <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Drop file here or click to browse · {hint}</p>
          <input id={inputId} type="file" accept={accept} className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          <Button variant="outline" size="sm" asChild>
            <label htmlFor={inputId} className="cursor-pointer">Choose file</label>
          </Button>
        </>
      )}
    </div>
  );
}
