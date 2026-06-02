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
    .select("site_id, hours_worked, date, sites!inner(id, name, billing_rate)")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .gte("date", startDate)
    .lte("date", endDate);
  if (body?.siteId) query = query.eq("site_id", body.siteId);

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) return json({ error: rowsErr.message }, 400);

  const bySite = new Map<string, { siteName: string; totalHours: number; rate: number }>();
  for (const row of rows ?? []) {
    const site = Array.isArray((row as any).sites) ? (row as any).sites[0] : (row as any).sites;
    const key = row.site_id as string;
    const current = bySite.get(key) ?? {
      siteName: site?.name ?? "Unknown Site",
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

    // Create as draft, attach the line item (a trigger derives invoice.total),
    // then issue — which posts the correct total to the ledger.
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        type: "AR",
        status: "draft",
        client_id: resolvedSiteId,
        pay_period_id: payPeriodId,
        total: 0,
        tax: 0,
        due_date: endDate,
      })
      .select("id")
      .single();
    if (invErr || !invoice) return json({ error: invErr?.message ?? "Invoice insert failed" }, 400);

    const { error: itemErr } = await admin.from("invoice_items").insert({
      invoice_id: invoice.id,
      description: `Guarding services (${startDate} to ${endDate}) - ${summary.siteName}`,
      quantity: hours,
      unit_price: summary.rate,
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
      siteId: resolvedSiteId,
      siteName: summary.siteName,
      hours,
      rate: summary.rate,
      total: Number((hours * summary.rate).toFixed(2)),
      status: issue ? "issued" : "draft",
    });
  }

  return json({ invoices });
});
