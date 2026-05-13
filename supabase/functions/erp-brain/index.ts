import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type Observation = {
  code: string;
  severity: "low" | "medium" | "high";
  summary: string;
  details?: Json;
};

type SuggestedAction = {
  priority: "low" | "medium" | "high";
  action: string;
  rationale: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const jsonPayload = atob(padded);
    return JSON.parse(jsonPayload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTenantId(claims: Record<string, unknown> | null): string | null {
  if (!claims) return null;
  const candidates = [
    claims.tenant_id,
    claims.org_id,
    claims.organization_id,
    (claims.app_metadata as Record<string, unknown> | undefined)?.tenant_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey || !anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization header." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.slice("Bearer ".length);

    // Validate JWT first using anon-key client.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claims = parseJwtClaims(jwt);
    const tenantId = extractTenantId(claims) ??
      (typeof userData.user.app_metadata?.tenant_id === "string" ? userData.user.app_metadata.tenant_id : null);

    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant_id found in JWT claims." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // READ-ONLY dataset (SELECT queries only)
    const [
      shiftLogsRes,
      sitesRes,
      assignmentsRes,
      accountsRes,
      entriesRes,
      linesRes,
      invoicesRes,
      invoiceItemsRes,
    ] = await Promise.all([
      adminClient.from("shift_logs").select("*").eq("tenant_id", tenantId),
      adminClient.from("sites").select("*").eq("tenant_id", tenantId),
      adminClient.from("schedule_assignments").select("*").eq("tenant_id", tenantId),
      adminClient.from("ledger_accounts").select("*").eq("tenant_id", tenantId),
      adminClient.from("ledger_entries").select("*").eq("tenant_id", tenantId),
      adminClient.from("ledger_lines").select("*").eq("tenant_id", tenantId),
      adminClient.from("invoices").select("*").eq("tenant_id", tenantId),
      adminClient.from("invoice_items").select("*").eq("tenant_id", tenantId),
    ]);

    const readErrors = [
      shiftLogsRes.error,
      sitesRes.error,
      assignmentsRes.error,
      accountsRes.error,
      entriesRes.error,
      linesRes.error,
      invoicesRes.error,
      invoiceItemsRes.error,
    ].filter(Boolean);

    if (readErrors.length > 0) {
      return new Response(JSON.stringify({ error: "Failed to read one or more ERP modules.", details: readErrors }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dataset = {
      tenant_id: tenantId,
      payroll: {
        shift_logs: shiftLogsRes.data ?? [],
        sites: sitesRes.data ?? [],
        schedule_assignments: assignmentsRes.data ?? [],
      },
      accounting: {
        ledger_accounts: accountsRes.data ?? [],
        ledger_entries: entriesRes.data ?? [],
        ledger_lines: linesRes.data ?? [],
        invoices: invoicesRes.data ?? [],
        invoice_items: invoiceItemsRes.data ?? [],
      },
    };

    const systemPrompt = `You are the System Intelligence Observer for an ERP. Analyze provided payroll and accounting data for discrepancies.\nOutput ONLY valid JSON with this exact shape:\n{\n  "Observations": [{"code": string, "severity": "low"|"medium"|"high", "summary": string, "details"?: any}],\n  "Suggested Actions": [{"priority": "low"|"medium"|"high", "action": string, "rationale": string}]\n}\nFocus on issues such as approved shifts not invoiced, invoice totals not aligning to ledger lines/entries, and unusual billing-rate mismatches.`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-latest",
        max_tokens: 1400,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this tenant ERP dataset:\n${JSON.stringify(dataset)}`,
          },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return new Response(JSON.stringify({ error: "Claude request failed.", details: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicJson = await anthropicResp.json();
    const raw = anthropicJson?.content?.[0]?.text;

    let parsed: { Observations: Observation[]; "Suggested Actions": SuggestedAction[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {
        Observations: [{
          code: "MODEL_OUTPUT_PARSE_ERROR",
          severity: "medium",
          summary: "Claude returned non-JSON output.",
          details: { raw },
        }],
        "Suggested Actions": [{
          priority: "medium",
          action: "Inspect model output format prompt and retry.",
          rationale: "The analysis could not be parsed into the required structure.",
        }],
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
