import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Upload, FileText, AlertTriangle, CheckCircle2, Loader2, Download } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { parseCsvFile, downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/employees/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Import employees — Dog Force Payroll" }] }),
});

const FIELDS = [
  { key: "employee_code", label: "Employee code", required: true },
  { key: "surname", label: "Surname", required: true },
  { key: "first_names", label: "First names", required: true },
  { key: "national_id", label: "National ID" },
  { key: "position", label: "Position (security_officer, supervisor, …)" },
  { key: "hourly_rate", label: "Hourly rate (NAD)" },
  { key: "transport_allowance", label: "Transport allowance" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "start_date", label: "Start date (YYYY-MM-DD)" },
  { key: "home_site", label: "Home site (name match)" },
  { key: "bank_name", label: "Bank name" },
  { key: "bank_account_number", label: "Bank account" },
  { key: "union_member", label: "Union member (yes/no)" },
  { key: "ordinarily_works_sundays", label: "Works Sundays (yes/no)" },
] as const;

type FieldKey = typeof FIELDS[number]["key"];

const IGNORE = "__ignore__";

const positionSchema = z.enum([
  "security_officer", "supervisor", "site_manager", "operations_manager", "admin", "other",
]);

type ParsedEmployee = {
  rowNumber: number;
  raw: Record<string, string>;
  values: {
    employee_code: string;
    surname: string;
    first_names: string;
    national_id: string | null;
    position: z.infer<typeof positionSchema>;
    hourly_rate: number;
    transport_allowance: number;
    phone: string | null;
    email: string | null;
    start_date: string | null;
    home_site_id: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
    union_member: boolean;
    ordinarily_works_sundays: boolean;
  } | null;
  errors: string[];
};

function parseBool(v: string): boolean {
  const x = v.trim().toLowerCase();
  return ["yes", "y", "true", "1", "t"].includes(x);
}

function ImportPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [importing, setImporting] = useState(false);
  const [filename, setFilename] = useState("");

  const { data: sites } = useQuery({
    queryKey: ["sites-list-import", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const siteByName = useMemo(() => {
    const map = new Map<string, string>();
    (sites ?? []).forEach((s) => map.set(s.name.toLowerCase(), s.id));
    return map;
  }, [sites]);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    try {
      const result = await parseCsvFile(file);
      setHeaders(result.headers);
      setRows(result.rows);

      // Auto-map by header name match
      const auto: Record<string, string> = {};
      for (const f of FIELDS) {
        const match = result.headers.find((h) =>
          h.toLowerCase().replace(/[\s_-]+/g, "") === f.key.replace(/[_]+/g, "")
        );
        if (match) auto[f.key] = match;
      }
      setMapping(auto as Record<FieldKey, string>);
      toast.success(`Loaded ${result.rows.length} rows from ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse CSV");
    }
  };

  const parsed = useMemo<ParsedEmployee[]>(() => {
    if (!rows.length) return [];
    const get = (row: Record<string, string>, key: FieldKey): string => {
      const col = mapping[key];
      if (!col || col === IGNORE) return "";
      return (row[col] ?? "").trim();
    };

    return rows.map((row, idx) => {
      const errors: string[] = [];
      const code = get(row, "employee_code");
      const surname = get(row, "surname");
      const firstNames = get(row, "first_names");

      if (!code) errors.push("Missing employee code");
      if (!surname) errors.push("Missing surname");
      if (!firstNames) errors.push("Missing first names");

      const positionRaw = (get(row, "position") || "security_officer").toLowerCase().replace(/\s+/g, "_");
      const positionParse = positionSchema.safeParse(positionRaw);
      if (!positionParse.success) errors.push(`Invalid position "${positionRaw}"`);

      const rateStr = get(row, "hourly_rate");
      const rate = rateStr ? Number(rateStr) : 16;
      if (Number.isNaN(rate)) errors.push(`Invalid hourly rate "${rateStr}"`);
      else if (rate < 16) errors.push(`Hourly rate ${rate} below N$16 minimum`);

      const transportStr = get(row, "transport_allowance");
      const transport = transportStr ? Number(transportStr) : 350;
      if (Number.isNaN(transport)) errors.push(`Invalid transport allowance "${transportStr}"`);

      let homeSiteId: string | null = null;
      const siteName = get(row, "home_site");
      if (siteName) {
        const found = siteByName.get(siteName.toLowerCase());
        if (!found) errors.push(`Site "${siteName}" not found — create it first`);
        else homeSiteId = found;
      }

      const startDate = get(row, "start_date");
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        errors.push(`Start date "${startDate}" must be YYYY-MM-DD`);
      }

      return {
        rowNumber: idx + 2,
        raw: row,
        errors,
        values: errors.length ? null : {
          employee_code: code,
          surname, first_names: firstNames,
          national_id: get(row, "national_id") || null,
          position: positionParse.success ? positionParse.data : "security_officer",
          hourly_rate: rate,
          transport_allowance: transport,
          phone: get(row, "phone") || null,
          email: get(row, "email") || null,
          start_date: startDate || null,
          home_site_id: homeSiteId,
          bank_name: get(row, "bank_name") || null,
          bank_account_number: get(row, "bank_account_number") || null,
          union_member: parseBool(get(row, "union_member")),
          ordinarily_works_sundays: parseBool(get(row, "ordinarily_works_sundays")),
        },
      };
    });
  }, [rows, mapping, siteByName]);

  const validCount = parsed.filter((p) => p.values).length;
  const errorCount = parsed.length - validCount;
  const requiredMapped = FIELDS.filter((f) => f.required).every((f) => mapping[f.key] && mapping[f.key] !== IGNORE);
  const canImport = parsed.length > 0 && validCount > 0 && requiredMapped;

  const handleImport = async () => {
    if (!profile?.tenant_id) return;
    setImporting(true);
    try {
      const valid = parsed.filter((p) => p.values).map((p) => p.values!);
      const payload = valid.map((v) => ({
        tenant_id: profile.tenant_id,
        ...v,
        category: v.position === "security_officer" || v.position === "supervisor" ? "officer" as const : "management" as const,
      }));

      // Chunk 100 at a time
      const chunks: typeof payload[] = [];
      for (let i = 0; i < payload.length; i += 100) chunks.push(payload.slice(i, i + 100));

      let imported = 0;
      for (const chunk of chunks) {
        const { error } = await supabase.from("employees").insert(chunk);
        if (error) throw error;
        imported += chunk.length;
      }
      toast.success(`Imported ${imported} employees`);
      void navigate({ to: "/employees" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    downloadCsv("employee-import-template.csv", [{
      employee_code: "DF001", surname: "Shikongo", first_names: "Petrus",
      national_id: "85010500123", position: "security_officer",
      hourly_rate: "16.00", transport_allowance: "350",
      phone: "+264811234567", email: "", start_date: "2024-01-15",
      home_site: "", bank_name: "FNB", bank_account_number: "62000000000",
      union_member: "no", ordinarily_works_sundays: "no",
    }]);
  };

  const downloadErrorReport = () => {
    const errs = parsed.filter((p) => p.errors.length).map((p) => ({
      row: p.rowNumber,
      errors: p.errors.join("; "),
      ...p.raw,
    }));
    if (!errs.length) { toast.info("No errors"); return; }
    downloadCsv(`import-errors-${Date.now()}.csv`, errs);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link to="/employees"><ArrowLeft className="mr-1 h-4 w-4" /> Back to employees</Link>
        </Button>
        <div className="flex items-center justify-between mt-3 gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Import employees</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bulk-load up to ~180 guards from CSV. Map your columns, review issues, then commit.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
        </div>
      </div>

      {!rows.length ? (
        <Card>
          <CardContent className="p-12">
            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="mt-4 font-medium">Drop a CSV file here, or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">
                First row should be column headers. UTF-8 encoded.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {filename}
                  </CardTitle>
                  <CardDescription>
                    {rows.length} rows · {headers.length} columns
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setRows([]); setHeaders([]); setMapping({} as Record<FieldKey, string>); }}>
                  Choose different file
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Map columns</CardTitle>
              <CardDescription>Match each ERP field to a CSV column. Required fields marked *.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {f.label} {f.required && <span className="text-destructive">*</span>}
                  </Label>
                  <Select
                    value={mapping[f.key] ?? IGNORE}
                    onValueChange={(v) => setMapping({ ...mapping, [f.key]: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Ignore" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>— Ignore —</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          {parsed.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total rows</div>
                <div className="font-mono text-2xl font-bold mt-1">{parsed.length}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Ready to import</div>
                <div className="font-mono text-2xl font-bold text-success mt-1">{validCount}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">With errors</div>
                <div className="font-mono text-2xl font-bold text-destructive mt-1">{errorCount}</div>
              </CardContent></Card>
            </div>
          )}

          {!requiredMapped && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Missing required mappings</AlertTitle>
              <AlertDescription>
                Map all required fields (employee code, surname, first names) before continuing.
              </AlertDescription>
            </Alert>
          )}

          {errorCount > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Rows with errors ({errorCount})
                  </CardTitle>
                  <CardDescription>These rows will be skipped. Fix them and re-upload, or import only the valid rows.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                  <Download className="mr-2 h-4 w-4" /> Error report
                </Button>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto space-y-2">
                  {parsed.filter((p) => p.errors.length).slice(0, 50).map((p) => (
                    <div key={p.rowNumber} className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <div className="font-mono text-xs text-muted-foreground">Row {p.rowNumber}</div>
                      <ul className="mt-1 space-y-0.5">
                        {p.errors.map((e, i) => <li key={i} className="text-destructive">• {e}</li>)}
                      </ul>
                    </div>
                  ))}
                  {errorCount > 50 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      Showing first 50 of {errorCount} errors. Download full report.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3 sticky bottom-4 rounded-lg border bg-background/95 backdrop-blur p-4 shadow-lg">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {validCount > 0 && <CheckCircle2 className="h-4 w-4 text-success" />}
              {validCount > 0 ? (
                <>Ready to import <Badge variant="outline" className="font-mono">{validCount}</Badge> employees</>
              ) : "Resolve errors above to enable import"}
            </div>
            <Button onClick={handleImport} disabled={!canImport || importing}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import {validCount} employees
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
