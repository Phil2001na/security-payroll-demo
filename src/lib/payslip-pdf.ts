import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PayslipCalc } from "./payroll-engine";
import { formatNAD } from "./format";

export function buildPayslipPDF(opts: {
  calc: PayslipCalc;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  tenantName: string;
}): jsPDF {
  const { calc, periodLabel, periodStart, periodEnd, tenantName } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18).setFont("helvetica", "bold");
  doc.text(tenantName, 40, 32);
  doc.setFontSize(10).setFont("helvetica", "normal");
  doc.text("PAYSLIP", 40, 52);
  doc.text(periodLabel, W - 40, 52, { align: "right" });

  doc.setTextColor(0, 0, 0);
  let y = 95;

  const e = calc.employee;
  const name = e.display_name ?? `${e.first_names} ${e.surname}`;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text(name, 40, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`Employee code: ${e.employee_code}`, 40, y + 14);
  doc.text(`Period: ${periodStart} — ${periodEnd}`, 40, y + 28);
  doc.text(`Rate: ${formatNAD(calc.rate)} / hour`, W - 40, y + 14, { align: "right" });
  doc.text(`Bank: ${e.bank_name ?? "—"} ${e.bank_account_number ?? ""}`, W - 40, y + 28, { align: "right" });

  y += 50;

  autoTable(doc, {
    startY: y,
    head: [["Earnings", "Hours", "Rate", "Amount"]],
    body: [
      ["Ordinary (≤60h/wk)", calc.normal_hours.toFixed(2), formatNAD(calc.rate), formatNAD(calc.normal_amount)],
      ["Overtime (1.5×)", calc.overtime_hours.toFixed(2), formatNAD(calc.rate * 1.5), formatNAD(calc.overtime_amount)],
      ["Sunday (2×)", calc.sunday_hours.toFixed(2), formatNAD(calc.rate * 2), formatNAD(calc.sunday_amount)],
      ["Public Holiday (2×)", calc.public_holiday_hours.toFixed(2), formatNAD(calc.rate * 2), formatNAD(calc.public_holiday_amount)],
      ["Night premium (6%)", calc.night_hours.toFixed(2), "", formatNAD(calc.night_premium_amount)],
      ["Transport allowance", "", "", formatNAD(calc.transport_allowance)],
      [{ content: "Gross salary", styles: { fontStyle: "bold" } }, "", "", { content: formatNAD(calc.gross_salary), styles: { fontStyle: "bold" } }],
    ],
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42] },
    styles: { fontSize: 9 },
  });

  // @ts-expect-error autotable adds this
  y = doc.lastAutoTable.finalY + 16;

  autoTable(doc, {
    startY: y,
    head: [["Deductions", "Amount"]],
    body: [
      ["PAYE (Income Tax)", formatNAD(calc.paye_amount)],
      ["Social Security (SSC)", formatNAD(calc.ssc_amount)],
      ["Disciplinary fines (with CA ref)", formatNAD(calc.fine_deductions)],
      ["Consensual deductions", formatNAD(calc.consensual_deductions)],
      [{ content: "Total deductions", styles: { fontStyle: "bold" } }, { content: formatNAD(calc.total_deductions), styles: { fontStyle: "bold" } }],
    ],
    theme: "striped",
    headStyles: { fillColor: [120, 53, 15] },
    styles: { fontSize: 9 },
  });

  // @ts-expect-error autotable
  y = doc.lastAutoTable.finalY + 24;

  doc.setFillColor(245, 158, 11);
  doc.rect(40, y, W - 80, 40, "F");
  doc.setTextColor(15, 23, 42).setFont("helvetica", "bold").setFontSize(14);
  doc.text("NET PAY", 56, y + 26);
  doc.text(formatNAD(calc.net_salary), W - 56, y + 26, { align: "right" });

  y += 56;
  doc.setTextColor(0, 0, 0).setFont("helvetica", "normal").setFontSize(8);
  if (calc.disqualified_fines > 0) {
    doc.setTextColor(180, 0, 0);
    doc.text(`NOTE: ${formatNAD(calc.disqualified_fines)} in fines could not be deducted — missing Collective Agreement reference (Labour Act s.12(5)).`, 40, y, { maxWidth: W - 80 });
    y += 20;
    doc.setTextColor(0, 0, 0);
  }
  doc.text("Computed per Namibian Labour Act (2007) and Income Tax Act. PAYE based on 2026 brackets.", 40, y, { maxWidth: W - 80 });

  return doc;
}

export function buildABSACsv(rows: Array<{
  account_number: string;
  branch_code: string;
  amount: number;
  beneficiary_name: string;
  payment_reference: string;
}>): string {
  const header = ["Account Number", "Branch Code", "Amount", "Beneficiary Name", "Payment Reference"];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      esc(r.account_number),
      esc(r.branch_code),
      esc(r.amount.toFixed(2)),
      esc(r.beneficiary_name),
      esc(r.payment_reference),
    ].join(","));
  }
  return lines.join("\n");
}
