import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server is missing required configuration." }, 500);
  }

  // --- Authenticate the caller ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid Authorization header." }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: "Unauthorized." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Tenant + role come from the server-side profile, never from the client.
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_active || !["admin", "operations", "accountant"].includes(profile.role)) {
    return json({ error: "Access denied. Billing requires admin, operations or accountant." }, 403);
  }
  const tenantId: string = profile.tenant_id;

  const body = await req.json().catch(() => null) as
    | { startDate?: string; endDate?: string; siteId?: string; issue?: boolean; payPeriodId?: string }
    | null;
  const startDate = body?.startDate;
  const endDate = body?.endDate;
  if (!startDate || !endDate) return json({ error: "startDate and endDate are required." }, 400);
  const issue = body?.issue === true;
  const payPeriodId = body?.payPeriodId ?? null;

  // Approved shift hours in range, scoped to the caller's tenant.
  let query = admin
    .from("shift_logs")
    .select("site_id, hours_worked, date, sites!inner(id, name, billing_rate, client_id, clients(name))")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .gte("date", startDate)
    .lte("date", endDate);
  if (body?.siteId) query = query.eq("site_id", body.siteId);

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) return json({ error: rowsErr.message }, 400);

  // Fetch tenant billing defaults
  const { data: tenantRow } = await admin
    .from("tenants")
    .select("default_tax_rate, invoice_due_days")
    .eq("id", tenantId)
    .maybeSingle();
  const defaultTaxRate = Number(tenantRow?.default_tax_rate ?? 0.15);
  const dueDays = Number(tenantRow?.invoice_due_days ?? 7);

  // Fetch pay period label for invoice description
  let periodLabel = `${startDate} to ${endDate}`;
  if (payPeriodId) {
    const { data: pp } = await admin
      .from("pay_periods").select("label").eq("id", payPeriodId).maybeSingle();
    if (pp?.label) periodLabel = pp.label;
  }

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + dueDays * 86400_000).toISOString().slice(0, 10);

  const bySite = new Map<string, { siteName: string; clientId: string | null; clientName: string; totalHours: number; rate: number }>();
  for (const row of rows ?? []) {
    const site = Array.isArray((row as any).sites) ? (row as any).sites[0] : (row as any).sites;
    const client = Array.isArray(site?.clients) ? site.clients[0] : site?.clients;
    const key = row.site_id as string;
    const current = bySite.get(key) ?? {
      siteName: site?.name || "Unknown Site",
      clientId: (site?.client_id as string | null) ?? null,
      clientName: client?.name || site?.name || "Unknown Client",
      totalHours: 0,
      rate: Number(site?.billing_rate ?? 0),
    };
    current.totalHours += Number(row.hours_worked ?? 0);
    bySite.set(key, current);
  }

  const invoices: Array<Record<string, unknown>> = [];
  for (const [resolvedSiteId, summary] of bySite) {
    const hours = Number(summary.totalHours.toFixed(2));
    if (hours <= 0 || summary.rate <= 0) continue;

    // Idempotent: skip if a non-void invoice already exists for this site + period
    if (payPeriodId) {
      const { data: existing } = await admin
        .from("invoices")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("site_id", resolvedSiteId)
        .eq("pay_period_id", payPeriodId)
        .neq("status", "void")
        .maybeSingle();
      if (existing) continue;
    }

    // Create as draft, attach the line item (a trigger derives invoice.total),
    // then optionally issue — which posts the correct total to the ledger.
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        type: "AR",
        status: "draft",
        client_id: summary.clientId,
        site_id: resolvedSiteId,
        pay_period_id: payPeriodId,
        invoice_date: today,
        due_date: dueDate,
        total: 0,
        tax: 0,
      })
      .select("id, invoice_number")
      .single();
    if (invErr || !invoice) return json({ error: invErr?.message ?? "Invoice insert failed" }, 400);

    const { error: itemErr } = await admin.from("invoice_items").insert({
      invoice_id: invoice.id,
      tenant_id: tenantId,
      description: `Security services — ${summary.siteName} — ${periodLabel}`,
      quantity: hours,
      unit_price: summary.rate,
      tax_rate: defaultTaxRate,
    });
    if (itemErr) {
      await admin.from("invoices").delete().eq("id", invoice.id);
      return json({ error: itemErr.message }, 400);
    }

    if (issue) {
      const { error: issueErr } = await admin
        .from("invoices")
        .update({ status: "issued", issued_at: new Date().toISOString() })
        .eq("id", invoice.id);
      if (issueErr) return json({ error: issueErr.message }, 400);
    }

    invoices.push({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      siteId: resolvedSiteId,
      siteName: summary.siteName,
      clientName: summary.clientName,
      hours,
      rate: summary.rate,
      total: Number((hours * summary.rate).toFixed(2)),
      status: issue ? "issued" : "draft",
    });
  }

  return json({ invoices });
});
