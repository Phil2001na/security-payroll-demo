import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ScheduleEntry = {
  date: string;
  shiftLabel: string;
  shiftCode: string;
  hours: number;
  siteName: string;
};

function dayMonth(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function dayName(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
}

export function buildScheduleSheetsPDF(opts: {
  employees: { id: string; employee_code: string; surname: string; first_names: string }[];
  assignmentsByEmployee: Map<string, ScheduleEntry[]>;
  rangeStart: string;
  rangeEnd: string;
  tenantName: string;
}): jsPDF {
  const { employees, assignmentsByEmployee, rangeStart, rangeEnd, tenantName } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  employees.forEach((emp, idx) => {
    if (idx > 0) doc.addPage();
    const shifts = (assignmentsByEmployee.get(emp.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const totalHours = shifts.reduce((s, x) => s + x.hours, 0);

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 70, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18).setFont("helvetica", "bold");
    doc.text(tenantName, 40, 32);
    doc.setFontSize(10).setFont("helvetica", "normal");
    doc.text("DUTY ROSTER", 40, 52);
    doc.text(`${rangeStart} — ${rangeEnd}`, W - 40, 52, { align: "right" });

    doc.setTextColor(0, 0, 0);
    const headerY = 95;
    const name = `${emp.surname}, ${emp.first_names}`;
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text(name, 40, headerY);
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(`Employee code: ${emp.employee_code}`, 40, headerY + 16);
    doc.text(`Total scheduled hours: ${totalHours}h`, W - 40, headerY + 16, { align: "right" });

    autoTable(doc, {
      startY: headerY + 36,
      head: [["Date", "Day", "Site", "Shift", "Hours"]],
      body: shifts.length
        ? shifts.map((s) => [dayMonth(s.date), dayName(s.date), s.siteName, `${s.shiftLabel} (${s.shiftCode})`, `${s.hours}h`])
        : [["—", "—", "No shifts scheduled in this period", "—", "—"]],
      theme: "striped",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 9 },
    });

    // @ts-expect-error autotable adds this
    const finalY = doc.lastAutoTable.finalY + 30;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100);
    doc.text("Acknowledged receipt of duty roster:", 40, finalY);
    doc.line(40, finalY + 28, 220, finalY + 28);
    doc.text("Guard signature", 40, finalY + 40);
    doc.line(260, finalY + 28, 440, finalY + 28);
    doc.text("Date", 260, finalY + 40);
  });

  return doc;
}
