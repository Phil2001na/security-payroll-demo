import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
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
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized." }, 401);
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

  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active || !["admin", "operations", "accountant"].includes(profile.role)) {
    return json({ error: "Access denied." }, 403);
  }

  const { invoiceId } = (await req.json().catch(() => ({}))) as { invoiceId?: string };
  if (!invoiceId) return json({ error: "invoiceId is required." }, 400);

  // Scope the lookup to the caller's tenant — prevents cross-tenant access (IDOR).
  const { data: invoice } = await admin
    .from("invoices")
    .select("id,total,tax,due_date,status,tenant_id,sites(name),invoice_items(description,quantity,unit_price)")
    .eq("id", invoiceId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (!invoice) return json({ error: "Invoice not found." }, 404);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 40, y: 760, width: 220, height: 50, color: rgb(0.08, 0.2, 0.35) });
  page.drawText("DOGFORCE", { x: 52, y: 790, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Security Services Invoice", { x: 52, y: 772, size: 10, font, color: rgb(1, 1, 1) });

  page.drawText(`Invoice: ${invoice.id}`, { x: 40, y: 730, size: 11, font });
  page.drawText(`Client: ${(invoice as any).sites?.name ?? "N/A"}`, { x: 40, y: 714, size: 11, font });
  page.drawText(`Due Date: ${invoice.due_date}`, { x: 40, y: 698, size: 11, font });

  let y = 650;
  page.drawText("Description", { x: 40, y, size: 11, font: bold });
  page.drawText("Qty", { x: 350, y, size: 11, font: bold });
  page.drawText("Unit", { x: 420, y, size: 11, font: bold });
  page.drawText("Total", { x: 500, y, size: 11, font: bold });

  y -= 20;
  for (const item of (invoice as any).invoice_items ?? []) {
    const lineTotal = Number(item.quantity) * Number(item.unit_price);
    page.drawText(String(item.description).slice(0, 48), { x: 40, y, size: 10, font });
    page.drawText(Number(item.quantity).toFixed(2), { x: 350, y, size: 10, font });
    page.drawText(Number(item.unit_price).toFixed(2), { x: 420, y, size: 10, font });
    page.drawText(lineTotal.toFixed(2), { x: 500, y, size: 10, font });
    y -= 16;
  }

  page.drawText(`Tax: ${Number(invoice.tax).toFixed(2)}`, { x: 420, y: 120, size: 11, font });
  page.drawText(`Amount Due: ${Number(invoice.total).toFixed(2)}`, { x: 420, y: 102, size: 12, font: bold });
  page.drawText("Payment instructions: EFT to Dogforce Operations Account within terms.", { x: 40, y: 70, size: 10, font });

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=invoice-${invoice.id}.pdf`,
    },
  });
});
