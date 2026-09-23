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

/** Every ISO date from start to end inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
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
  const allDates = datesBetween(rangeStart, rangeEnd);

  employees.forEach((emp, idx) => {
    if (idx > 0) doc.addPage();
    const shifts = (assignmentsByEmployee.get(emp.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const totalHours = shifts.reduce((s, x) => s + x.hours, 0);
    const byDate = new Map(shifts.map((s) => [s.date, s]));
    const offDays = allDates.filter((d) => !byDate.has(d)).length;

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
    doc.text(`Total scheduled hours: ${totalHours}h · Off days: ${offDays}`, W - 40, headerY + 16, {
      align: "right",
    });

    // Every date in the range, so off days are printed too (DogForce ops, 23 Sep).
    autoTable(doc, {
      startY: headerY + 36,
      head: [["Date", "Day", "Site", "Shift", "Hours"]],
      body: allDates.map((d) => {
        const s = byDate.get(d);
        return s
          ? [dayMonth(d), dayName(d), s.siteName, `${s.shiftLabel} (${s.shiftCode})`, `${s.hours}h`]
          : [dayMonth(d), dayName(d), "—", "OFF", "—"];
      }),
      theme: "striped",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8, cellPadding: 2.5 },
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

// ── Site roster: one landscape page per site, guards × dates, like DogForce's own sheet ──

export type SiteRosterCell = "DS" | "NS" | "STBY" | "L" | "OFF" | string;

export type SiteRosterSheet = {
  siteName: string;
  guards: { name: string; code: string; cells: SiteRosterCell[] }[];
  /** Guards needed per date, from the site's requirements. */
  neededDay: number[];
  neededNight: number[];
};

/** Short code for a site ("Scrap Northern" → "SN"), used when a guard works elsewhere. */
export function siteAbbrev(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(and|the|of|no)$/i.test(w));
  const initials = words.map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join("");
  return (initials || name.slice(0, 3).toUpperCase()).slice(0, 4);
}

export function buildSiteRosterPDF(opts: {
  sheets: SiteRosterSheet[];
  dates: string[];
  specialDates: Set<string>; // Sundays + public holidays, shaded
  otherSiteLegend: Map<string, string>; // abbrev → site name
  tenantName: string;
}): jsPDF {
  const { sheets, dates, specialDates, otherSiteLegend, tenantName } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const margin = 14;
  const nameW = 104;
  const totW = 22;
  const dayW = Math.min(24, (W - margin * 2 - nameW - totW * 4) / Math.max(dates.length, 1));

  const fills: Record<string, [number, number, number]> = {
    DS: [254, 243, 199],
    NS: [219, 234, 254],
    STBY: [237, 233, 254],
    L: [220, 252, 231],
    OFF: [255, 255, 255],
  };

  sheets.forEach((sheet, idx) => {
    if (idx > 0) doc.addPage();
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 50, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold").setFontSize(14);
    doc.text(tenantName, margin, 22);
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text("SITE DUTY ROSTER", margin, 38);
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text(sheet.siteName, W / 2, 30, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(`${dates[0]} — ${dates[dates.length - 1]}`, W - margin, 22, { align: "right" });
    doc.text(`Officers allocated: ${sheet.guards.length}`, W - margin, 38, { align: "right" });

    const specialIdx = new Set(dates.map((d, i) => (specialDates.has(d) ? i : -1)).filter((i) => i >= 0));
    const head = [
      [
        "Guard",
        ...dates.map((d) => `${Number(d.slice(8))}\n${dayName(d).slice(0, 2)}`),
        "Days",
        "Sun/PH",
        "STBY",
        "OFF",
      ],
    ];
    const body: string[][] = sheet.guards.map((g) => {
      const worked = g.cells.filter((c) => c !== "OFF" && c !== "STBY" && c !== "L").length;
      const sunPh = g.cells.filter(
        (c, i) => specialIdx.has(i) && c !== "OFF" && c !== "STBY" && c !== "L",
      ).length;
      return [
        g.name,
        ...g.cells,
        String(worked),
        String(sunPh),
        String(g.cells.filter((c) => c === "STBY").length),
        String(g.cells.filter((c) => c === "OFF").length),
      ];
    });
    const coverage = (kind: "DS" | "NS", needed: number[]) => [
      kind === "DS" ? "Day on duty / needed" : "Night on duty / needed",
      ...dates.map((_, i) => {
        const on = sheet.guards.filter((g) => g.cells[i] === kind).length;
        return needed[i] ? `${on}/${needed[i]}` : on ? String(on) : "";
      }),
      "",
      "",
      "",
      "",
    ];
    const foot = [coverage("DS", sheet.neededDay), coverage("NS", sheet.neededNight)];

    autoTable(doc, {
      startY: 60,
      margin: { left: margin, right: margin },
      head,
      body: body.length ? body : [["No guards rostered at this site in this period"]],
      foot,
      theme: "grid",
      showFoot: "lastPage",
      styles: { fontSize: 6.5, cellPadding: 1.5, halign: "center", valign: "middle", lineWidth: 0.3 },
      headStyles: { fillColor: [15, 23, 42], fontSize: 6, cellPadding: 1.5 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 6 },
      columnStyles: {
        0: { cellWidth: nameW, halign: "left" },
        ...Object.fromEntries(dates.map((_, i) => [i + 1, { cellWidth: dayW }])),
        ...Object.fromEntries([0, 1, 2, 3].map((k) => [dates.length + 1 + k, { cellWidth: totW, fontStyle: "bold" }])),
      },
      didParseCell: (data) => {
        const col = data.column.index - 1;
        if (data.section === "body" && col >= 0 && col < dates.length) {
          const v = String(data.cell.raw ?? "");
          const fill = fills[v] ?? [254, 226, 226]; // another site's code
          data.cell.styles.fillColor = fill;
          if (v === "OFF") data.cell.styles.textColor = [148, 163, 184];
        }
        if (data.section === "foot" && col >= 0 && col < dates.length) {
          const [on, need] = String(data.cell.raw ?? "").split("/").map(Number);
          if (need && on < need) {
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = "bold";
          }
        }
        if (data.section === "head" && col >= 0 && col < dates.length && specialIdx.has(col)) {
          data.cell.styles.fillColor = [185, 28, 28];
        }
      },
    });

    // @ts-expect-error autotable adds this
    let y = doc.lastAutoTable.finalY + 12;
    const legend = [
      "DS = Day shift",
      "NS = Night shift",
      "STBY = Standby",
      "L = Leave",
      "OFF = Off day",
      "Red dates = Sunday / public holiday",
    ];
    const codesHere = new Set(sheet.guards.flatMap((g) => g.cells).filter((c) => otherSiteLegend.has(c)));
    for (const c of codesHere) legend.push(`${c} = ${otherSiteLegend.get(c)}`);
    doc.setTextColor(71, 85, 105).setFont("helvetica", "normal").setFontSize(7);
    const lines = doc.splitTextToSize(legend.join("   ·   "), W - margin * 2);
    if (y + lines.length * 9 + 30 > doc.internal.pageSize.getHeight()) {
      doc.addPage();
      y = 30;
    }
    doc.text(lines, margin, y);
    y += lines.length * 9 + 22;
    doc.setDrawColor(148, 163, 184);
    doc.line(margin, y, margin + 180, y);
    doc.text("Operations manager", margin, y + 10);
    doc.line(margin + 220, y, margin + 400, y);
    doc.text("Date", margin + 220, y + 10);
  });

  return doc;
}
