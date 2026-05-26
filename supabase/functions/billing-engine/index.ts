import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { startDate, endDate, siteId, issue = false } = await req.json();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error: scheduleError } = await supabase
    .from("shift_logs")
    .select("site_id, employee_id, hours_worked, assignments!inner(date), sites!inner(id, billing_rate, name)")
    .eq("status", "approved")
    .gte("assignments.date", startDate)
    .lte("assignments.date", endDate)
    .match(siteId ? { site_id: siteId } : {});

  if (scheduleError) return new Response(JSON.stringify({ error: scheduleError.message }), { status: 400, headers: corsHeaders });

  const bySite = new Map<string, { siteName: string; totalHours: number; rate: number }>();
  for (const row of rows ?? []) {
    const site = Array.isArray((row as any).sites) ? (row as any).sites[0] : (row as any).sites;
    const key = row.site_id as string;
    const current = bySite.get(key) ?? { siteName: site?.name ?? "Unknown Site", totalHours: 0, rate: Number(site?.billing_rate ?? 0) };
    current.totalHours += Number(row.hours_worked ?? 0);
    bySite.set(key, current);
  }

  const invoices = [];
  for (const [resolvedSiteId, summary] of bySite) {
    const total = Number((summary.totalHours * summary.rate).toFixed(2));
    const invoicePayload = {
      tenant_id: req.headers.get("x-tenant-id"),
      type: "AR",
      status: issue ? "issued" : "draft",
      client_id: resolvedSiteId,
      total,
      tax: 0,
      due_date: endDate,
      issued_at: issue ? new Date().toISOString() : null,
    };

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert(invoicePayload)
      .select("id")
      .single();

    if (invoiceError) return new Response(JSON.stringify({ error: invoiceError.message }), { status: 400, headers: corsHeaders });

    const { error: itemError } = await supabase.from("invoice_items").insert({
      invoice_id: invoice.id,
      description: `Guarding services (${startDate} to ${endDate}) - ${summary.siteName}`,
      quantity: Number(summary.totalHours.toFixed(2)),
      unit_price: summary.rate,
    });

    if (itemError) return new Response(JSON.stringify({ error: itemError.message }), { status: 400, headers: corsHeaders });

    invoices.push({ id: invoice.id, siteId: resolvedSiteId, ...summary, total });
  }

  return new Response(JSON.stringify({ invoices }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
