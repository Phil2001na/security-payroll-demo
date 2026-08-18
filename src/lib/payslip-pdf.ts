import { jsPDF } from "jspdf";
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
  doc.text(`Period: ${periodStart} - ${periodEnd}`, 40, y + 28);
  doc.text(`Rate: ${formatNAD(calc.rate)} / hour`, W - 40, y + 14, { align: "right" });
  doc.text(`Bank: ${e.bank_name ?? "-"} ${e.bank_account_number ?? ""}`, W - 40, y + 28, {
    align: "right",
  });

  y += 50;

  // Derive each premium's effective multiplier from the computed amounts so the labels
  // and unit rates stay consistent with whatever the tenant has configured (e.g. a 1.5×
  // Sunday rate for agreement employees, or an edited night premium).
  const effMult = (amount: number, hours: number, fallback: number) =>
    hours > 0 && calc.rate > 0 ? amount / (hours * calc.rate) : fallback;
  const fmtMult = (m: number) => `${Math.round(m * 100) / 100}x`;
  const otMult = effMult(calc.overtime_amount, calc.overtime_hours, 1.5);
  // Rostered Sundays fall back to the agreed 1.5×; Sunday call-ins and every public
  // holiday fall back to the 2× default.
  const sundayMult = effMult(calc.sunday_amount, calc.sunday_hours, 1.5);
  const phMult = effMult(calc.public_holiday_amount, calc.public_holiday_hours, 2);
  const nightPct = effMult(calc.night_premium_amount, calc.night_hours, 0);
  const nightLabel =
    calc.night_hours > 0 ? `Night premium (${Math.round(nightPct * 1000) / 10}%)` : "Night premium";
  const paidLeaveHours =
    calc.annual_leave_hours +
    calc.sick_leave_hours +
    calc.compassionate_leave_hours +
    calc.maternity_paid_hours;
  const workedOrdinaryHours = Math.max(0, calc.normal_hours - paidLeaveHours);

  autoTable(doc, {
    startY: y,
    head: [["Earnings", "Hours", "Rate", "Amount"]],
    body: [
      [
        "Ordinary worked (<=60h/wk)",
        workedOrdinaryHours.toFixed(2),
        formatNAD(calc.rate),
        formatNAD(workedOrdinaryHours * calc.rate),
      ],
      ...(calc.annual_leave_hours > 0
        ? [
            [
              "Annual leave",
              calc.annual_leave_hours.toFixed(2),
              formatNAD(calc.rate),
              formatNAD(calc.annual_leave_hours * calc.rate),
            ],
          ]
        : []),
      ...(calc.sick_leave_hours > 0
        ? [
            [
              "Sick leave",
              calc.sick_leave_hours.toFixed(2),
              formatNAD(calc.rate),
              formatNAD(calc.sick_leave_hours * calc.rate),
            ],
          ]
        : []),
      ...(calc.compassionate_leave_hours > 0
        ? [
            [
              "Compassionate leave",
              calc.compassionate_leave_hours.toFixed(2),
              formatNAD(calc.rate),
              formatNAD(calc.compassionate_leave_hours * calc.rate),
            ],
          ]
        : []),
      ...(calc.maternity_paid_hours > 0
        ? [
            [
              "Maternity leave - paid",
              calc.maternity_paid_hours.toFixed(2),
              formatNAD(calc.rate),
              formatNAD(calc.maternity_paid_hours * calc.rate),
            ],
          ]
        : []),
      ...(calc.maternity_leave_hours - calc.maternity_paid_hours > 0
        ? [
            [
              "Maternity leave - unpaid",
              (calc.maternity_leave_hours - calc.maternity_paid_hours).toFixed(2),
              "-",
              formatNAD(0),
            ],
          ]
        : []),
      ...(calc.unpaid_leave_hours > 0
        ? [["Unpaid leave", calc.unpaid_leave_hours.toFixed(2), "-", formatNAD(0)]]
        : []),
      [
        `Overtime (${fmtMult(otMult)})`,
        calc.overtime_hours.toFixed(2),
        formatNAD(calc.rate * otMult),
        formatNAD(calc.overtime_amount),
      ],
      [
        `Sunday (${fmtMult(sundayMult)})`,
        calc.sunday_hours.toFixed(2),
        formatNAD(calc.rate * sundayMult),
        formatNAD(calc.sunday_amount),
      ],
      // Sundays worked as cover are a separate line: the guard didn't agree to them, so
      // they carry the full multiplier even when the rostered Sundays above don't.
      ...(calc.sunday_callin_hours > 0
        ? [
            [
              `Sunday call-in (${fmtMult(effMult(calc.sunday_callin_amount, calc.sunday_callin_hours, 2))})`,
              calc.sunday_callin_hours.toFixed(2),
              formatNAD(
                calc.rate * effMult(calc.sunday_callin_amount, calc.sunday_callin_hours, 2),
              ),
              formatNAD(calc.sunday_callin_amount),
            ],
          ]
        : []),
      [
        `Public Holiday (${fmtMult(phMult)})`,
        calc.public_holiday_hours.toFixed(2),
        formatNAD(calc.rate * phMult),
        formatNAD(calc.public_holiday_amount),
      ],
      [nightLabel, calc.night_hours.toFixed(2), "", formatNAD(calc.night_premium_amount)],
      // Show the basis when the allowance was prorated — an employee who sees a smaller
      // transport figure than last month is owed the reason on the payslip itself.
      [
        calc.transport_days_worked != null && calc.transport_expected_days != null
          ? `Transport allowance (${calc.transport_days_worked}/${Math.round(calc.transport_expected_days)} days)`
          : "Transport allowance",
        "",
        "",
        formatNAD(calc.transport_allowance),
      ],
      [
        { content: "Gross salary", styles: { fontStyle: "bold" } },
        "",
        "",
        { content: formatNAD(calc.gross_salary), styles: { fontStyle: "bold" } },
      ],
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
      [
        { content: "Total deductions", styles: { fontStyle: "bold" } },
        { content: formatNAD(calc.total_deductions), styles: { fontStyle: "bold" } },
      ],
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
    doc.text(
      `NOTE: ${formatNAD(calc.disqualified_fines)} in fines could not be deducted - missing Collective Agreement reference (Labour Act s.12(5)).`,
      40,
      y,
      { maxWidth: W - 80 },
    );
    y += 20;
    doc.setTextColor(0, 0, 0);
  }
  doc.text(
    "Computed per applicable Labour Act and Income Tax Act. PAYE based on current tax brackets.",
    40,
    y,
    { maxWidth: W - 80 },
  );

  return doc;
}

export function buildABSACsv(
  rows: Array<{
    account_number: string;
    branch_code: string;
    amount: number;
    beneficiary_name: string;
    payment_reference: string;
  }>,
): string {
  const header = [
    "Account Number",
    "Branch Code",
    "Amount",
    "Beneficiary Name",
    "Payment Reference",
  ];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.account_number),
        esc(r.branch_code),
        esc(r.amount.toFixed(2)),
        esc(r.beneficiary_name),
        esc(r.payment_reference),
      ].join(","),
    );
  }
  return lines.join("\n");
}
