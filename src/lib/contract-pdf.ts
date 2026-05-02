// Contract PDF generator. Merges a tenant template with employee-specific fields
// and produces a downloadable PDF the guard can read offline before signing.
import jsPDF from "jspdf";

export type ContractKind = "officer" | "driver" | "management";

export type ContractEmployee = {
  surname: string;
  first_names: string;
  employee_code: string;
  national_id: string | null;
  position: string;
  hourly_rate: number;
  monthly_salary: number;
  transport_allowance: number;
  start_date: string | null;
  home_site_name: string | null;
};

export type ContractTenant = {
  name: string;
  legal_name: string | null;
};

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export function templateForPosition(position: string): ContractKind {
  if (position === "driver") return "driver";
  if (["site_manager", "operations_manager", "admin", "other"].includes(position)) return "management";
  return "officer";
}

export function pickTemplate(
  templates: { officer: string | null; driver: string | null; management: string | null },
  kind: ContractKind,
): string {
  return (templates[kind] ?? "").trim();
}

export function mergeTemplate(template: string, emp: ContractEmployee, tenant: ContractTenant): string {
  const fullName = `${emp.first_names} ${emp.surname}`;
  const compLine =
    emp.monthly_salary > 0
      ? `Monthly salary: NAD ${emp.monthly_salary.toFixed(2)}`
      : `Hourly rate: NAD ${emp.hourly_rate.toFixed(2)}`;
  const map: Record<string, string> = {
    company_name: tenant.legal_name || tenant.name,
    employee_full_name: fullName,
    employee_surname: emp.surname,
    employee_first_names: emp.first_names,
    employee_code: emp.employee_code,
    national_id: emp.national_id ?? "________________",
    position: emp.position.replace(/_/g, " "),
    hourly_rate: emp.hourly_rate.toFixed(2),
    monthly_salary: emp.monthly_salary.toFixed(2),
    compensation_line: compLine,
    transport_allowance: emp.transport_allowance.toFixed(2),
    start_date: emp.start_date ?? "________________",
    home_site: emp.home_site_name ?? "to be assigned",
    today: new Date().toISOString().slice(0, 10),
  };
  return template.replace(TOKEN_RE, (_m, key) => map[String(key).toLowerCase()] ?? `{{${key}}}`);
}

export function generateContractPdf(opts: {
  template: string;
  kind: ContractKind;
  employee: ContractEmployee;
  tenant: ContractTenant;
}): { blob: Blob; fileName: string; merged: string } {
  const merged = mergeTemplate(opts.template, opts.employee, opts.tenant);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.tenant.legal_name || opts.tenant.name, margin, margin);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const titleMap: Record<ContractKind, string> = {
    officer: "Security Officer Employment Contract",
    driver: "Driver Employment Contract",
    management: "Management Employment Contract",
  };
  doc.text(titleMap[opts.kind], margin, margin + 18);

  // Employee block
  doc.setDrawColor(180);
  doc.line(margin, margin + 26, pageW - margin, margin + 26);
  doc.setFontSize(10);
  const empLines = [
    `Employee: ${opts.employee.first_names} ${opts.employee.surname}  (${opts.employee.employee_code})`,
    `National ID: ${opts.employee.national_id ?? "________________"}`,
    `Position: ${opts.employee.position.replace(/_/g, " ")}`,
    `Site: ${opts.employee.home_site_name ?? "—"}`,
    `Start date: ${opts.employee.start_date ?? "—"}`,
  ];
  let y = margin + 42;
  for (const line of empLines) {
    doc.text(line, margin, y);
    y += 13;
  }
  y += 10;

  // Body — wrap merged text
  doc.setFontSize(10.5);
  const wrapped = doc.splitTextToSize(merged || "(No template configured for this position)", usableW);
  for (const line of wrapped as string[]) {
    if (y > pageH - margin - 90) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 14;
  }

  // Signature block at bottom of last page
  if (y > pageH - margin - 90) {
    doc.addPage();
    y = margin;
  }
  y = Math.max(y + 30, pageH - margin - 80);
  doc.setDrawColor(60);
  doc.line(margin, y, margin + 220, y);
  doc.line(pageW - margin - 220, y, pageW - margin, y);
  doc.setFontSize(9);
  doc.text("Employee signature & date", margin, y + 14);
  doc.text("For the Company", pageW - margin - 220, y + 14);

  const blob = doc.output("blob");
  const safe = `${opts.employee.surname}-${opts.employee.first_names}`.replace(/[^a-z0-9-]/gi, "_");
  return { blob, fileName: `contract-${safe}-${opts.employee.employee_code}.pdf`, merged };
}
