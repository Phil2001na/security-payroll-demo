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

// N$ 1,234.56
function money(n: number): string {
  return "N$ " + Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtDate(d: string | null): string {
  if (!d) return "-";
  const dt = new Date(d);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server is missing required configuration." }, 500);
  }

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

  // Accept either invoice_id (UI) or invoiceId (legacy).
  const payload = (await req.json().catch(() => ({}))) as { invoice_id?: string; invoiceId?: string };
  const invoiceId = payload.invoice_id ?? payload.invoiceId;
  if (!invoiceId) return json({ error: "invoice_id is required." }, 400);

  const { data: invoice } = await admin
    .from("invoices")
    .select(`
      id, invoice_number, type, status, total, tax, due_date, invoice_date, notes,
      tenant_id,
      clients:client_id ( name, address, vat_number ),
      sites:site_id ( name ),
      vendors:vendor_id ( name, address, vat_number ),
      invoice_items ( description, quantity, unit_price, tax_rate )
    `)
    .eq("id", invoiceId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (!invoice) return json({ error: "Invoice not found." }, 404);

  const { data: tenant } = await admin
    .from("tenants")
    .select(`name, legal_name, registered_address, vat_number, company_phone, company_email,
             company_website, logo_url, bank_name, bank_account_name, bank_account_number,
             bank_branch_name, bank_branch_code, invoice_penalty_note, invoice_footer_note`)
    .eq("id", invoice.tenant_id)
    .maybeSingle();

  const t = tenant ?? {} as Record<string, unknown>;
  const companyName = (t.legal_name as string) || (t.name as string) || "Company";

  // Counterparty (bill-to for AR; supplier for AP)
  const client = Array.isArray((invoice as any).clients) ? (invoice as any).clients[0] : (invoice as any).clients;
  const site = Array.isArray((invoice as any).sites) ? (invoice as any).sites[0] : (invoice as any).sites;
  const vendor = Array.isArray((invoice as any).vendors) ? (invoice as any).vendors[0] : (invoice as any).vendors;
  const isAR = invoice.type === "AR";
  const partyName = isAR
    ? [client?.name || "Client", site?.name ? `Site: ${site.name}` : ""].filter(Boolean).join(" — ")
    : (vendor?.name || "Supplier");
  const partyAddress = isAR ? (client?.address || "") : (vendor?.address || "");

  const items = ((invoice as any).invoice_items ?? []) as Array<{
    description: string; quantity: number; unit_price: number; tax_rate: number;
  }>;
  const total = Number(invoice.total || 0);
  const tax = Number(invoice.tax || 0);
  const subtotal = total - tax;

  // ---- PDF ----
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const M = 40;
  const ink = rgb(0.12, 0.12, 0.14);
  const muted = rgb(0.42, 0.45, 0.5);
  const accent = rgb(0.16, 0.39, 0.62);
  const gold = rgb(0.72, 0.55, 0.15);
  const lineGrey = rgb(0.85, 0.86, 0.88);

  const text = (s: string, x: number, y: number, size: number, f = font, color = ink) =>
    page.drawText(s ?? "", { x, y, size, font: f, color });
  const rightText = (s: string, xRight: number, y: number, size: number, f = font, color = ink) => {
    const w = f.widthOfTextAtSize(s ?? "", size);
    page.drawText(s ?? "", { x: xRight - w, y, size, font: f, color });
  };
  const wrap = (s: string, size: number, maxW: number, f = font): string[] => {
    const words = (s ?? "").split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const tryLine = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(tryLine, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = tryLine;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  let logoDims: { w: number; h: number } | null = null;
  let logoImg: any = null;
  if (t.logo_url) {
    try {
      const resp = await fetch(t.logo_url as string);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const ct = resp.headers.get("content-type") ?? "";
      logoImg = ct.includes("png") || (t.logo_url as string).toLowerCase().endsWith(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const scale = 64 / logoImg.height;
      logoDims = { w: logoImg.width * scale, h: 64 };
    } catch { logoImg = null; }
  }

  // ---- Header: logo + company identity ----
  let headerX = M;
  let topY = 800;
  if (logoImg && logoDims) {
    page.drawImage(logoImg, { x: M, y: topY - logoDims.h + 10, width: logoDims.w, height: logoDims.h });
    headerX = M + logoDims.w + 14;
  }
  if (t.vat_number) text(`VAT No reg: ${t.vat_number}`, headerX, topY, 9, font, muted);
  text(companyName, headerX, topY - 16, 12, bold, ink);
  let hy = topY - 30;
  for (const line of String(t.registered_address ?? "").split(/\r?\n/).filter(Boolean)) {
    text(line, headerX, hy, 9, font, muted);
    hy -= 12;
  }

  // ---- Bill-to (right) ----
  let by = 700;
  text(isAR ? "" : "Supplier", W - M - 220, by + 14, 9, bold, muted);
  text(partyName, W - M - 220, by, 11, bold, ink);
  by -= 14;
  for (const line of String(partyAddress).split(/\r?\n/).filter(Boolean)) {
    text(line, W - M - 220, by, 9, font, muted);
    by -= 12;
  }

  // ---- Title ----
  const titleLabel = isAR ? "Invoice" : "Bill";
  text(`${titleLabel} ${invoice.invoice_number ?? invoice.id.slice(0, 8)}`, M, 628, 22, bold, accent);

  // ---- Dates ----
  text("Invoice Date", M, 596, 9, bold, gold);
  text(fmtDate(invoice.invoice_date), M, 582, 10, font, ink);
  text("Due Date", M + 200, 596, 9, bold, gold);
  text(fmtDate(invoice.due_date), M + 200, 582, 10, font, ink);

  // ---- Items table ----
  const colDesc = M;
  const colQty = 330;
  const colUnit = 410;
  const colTax = 470;
  const colAmt = W - M;
  let y = 548;
  text("Description", colDesc, y, 9, bold, muted);
  rightText("Quantity", colUnit - 8, y, 9, bold, muted);
  rightText("Unit Price", colTax - 8, y, 9, bold, muted);
  rightText("Taxes", colTax + 28, y, 9, bold, muted);
  rightText("Amount", colAmt, y, 9, bold, muted);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: lineGrey });
  y -= 16;

  for (const it of items) {
    const amt = Number(it.quantity) * Number(it.unit_price);
    const descLines = wrap(it.description, 9.5, colQty - colDesc - 10);
    const rowH = Math.max(descLines.length * 12, 14);
    if (y - rowH < 220) { // new page guard
      page.drawText("(continued)", { x: M, y: 200, size: 8, font, color: muted });
      break;
    }
    descLines.forEach((ln, i) => text(ln, colDesc, y - i * 12, 9.5, font, ink));
    rightText(`${Number(it.quantity).toFixed(2)} Units`, colUnit - 8, y, 9.5, font, ink);
    rightText(Number(it.unit_price).toFixed(2), colTax - 8, y, 9.5, font, ink);
    rightText(`${Math.round(Number(it.tax_rate) * 100)}%`, colTax + 28, y, 9.5, font, ink);
    rightText(money(amt), colAmt, y, 9.5, font, ink);
    y -= rowH + 10;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: rgb(0.93, 0.94, 0.95) });
  }

  // ---- Totals box (right) + payment comm (left) ----
  const boxY = 150;
  // Payment communication + penalty
  text("Payment Communication:", M, boxY + 30, 9.5, font, ink);
  text(invoice.invoice_number ?? "", M + 130, boxY + 30, 9.5, bold, ink);
  if (t.invoice_penalty_note) {
    let py = boxY + 12;
    for (const ln of wrap(String(t.invoice_penalty_note), 9, 250, font)) {
      text(ln, M, py, 9, font, muted);
      py -= 12;
    }
  }

  // Totals
  const tboxX = 330;
  const tboxR = W - M;
  const rowL = (label: string, val: string, yy: number, strong = false) => {
    page.drawRectangle({ x: tboxX, y: yy - 5, width: tboxR - tboxX, height: 22, color: strong ? rgb(0.93, 0.95, 0.98) : rgb(0.97, 0.98, 0.99) });
    text(label, tboxX + 10, yy + 2, strong ? 11 : 9.5, strong ? bold : font, strong ? accent : muted);
    rightText(val, tboxR - 10, yy + 2, strong ? 11 : 9.5, strong ? bold : font, strong ? accent : ink);
  };
  rowL("Untaxed Amount", money(subtotal), boxY + 36);
  rowL(`TAX`, money(tax), boxY + 12);
  rowL("Total", money(total), boxY - 14, true);

  // ---- Bank details ----
  let bky = 96;
  if (t.bank_name) { text(String(t.bank_name), M, bky, 9.5, bold, ink); bky -= 13; }
  const bankRows: Array<[string, unknown]> = [
    ["Account Name:", t.bank_account_name],
    ["Account Number:", t.bank_account_number],
    ["Branch Name:", t.bank_branch_name],
    ["Branch Code:", t.bank_branch_code],
  ];
  for (const [label, val] of bankRows) {
    if (!val) continue;
    text(label, M, bky, 9, font, muted);
    text(String(val), M + 90, bky, 9, font, ink);
    bky -= 12;
  }

  // ---- Footer ----
  page.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, thickness: 0.5, color: lineGrey });
  const footerParts: string[] = [];
  if (t.company_phone) footerParts.push(`Phone: ${t.company_phone}`);
  if (t.company_email) footerParts.push(`Email: ${t.company_email}`);
  if (t.company_website) footerParts.push(`Web: ${t.company_website}`);
  const footer = footerParts.join("   |   ");
  const fw = font.widthOfTextAtSize(footer, 8);
  text(footer, (W - fw) / 2, 40, 8, font, muted);
  if (t.invoice_footer_note) {
    const nw = font.widthOfTextAtSize(String(t.invoice_footer_note), 8);
    text(String(t.invoice_footer_note), (W - nw) / 2, 28, 8, font, muted);
  }
  const pg = "Page 1 / 1";
  text(pg, (W - font.widthOfTextAtSize(pg, 8)) / 2, 16, 8, font, muted);

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=${invoice.invoice_number ?? invoice.id}.pdf`,
    },
  });
});
