import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const { invoiceId } = await req.json();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id,total,tax,due_date,status,sites(name),invoice_items(description,quantity,unit_price)")
    .eq("id", invoiceId)
    .single();

  if (!invoice) return new Response(JSON.stringify({ error: "Invoice not found" }), { status: 404 });

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
    page.drawText(item.description.slice(0, 48), { x: 40, y, size: 10, font });
    page.drawText(Number(item.quantity).toFixed(2), { x: 350, y, size: 10, font });
    page.drawText(Number(item.unit_price).toFixed(2), { x: 420, y, size: 10, font });
    page.drawText(lineTotal.toFixed(2), { x: 500, y, size: 10, font });
    y -= 16;
  }

  page.drawText(`Tax: ${Number(invoice.tax).toFixed(2)}`, { x: 420, y: 120, size: 11, font });
  page.drawText(`Amount Due: ${Number(invoice.total).toFixed(2)}`, { x: 420, y: 102, size: 12, font: bold });
  page.drawText("Payment instructions: EFT to Dogforce Operations Account within terms.", { x: 40, y: 70, size: 10, font });

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename=invoice-${invoice.id}.pdf` } });
});
