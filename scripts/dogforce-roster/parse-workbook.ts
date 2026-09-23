// Usage: bun scripts/dogforce-roster/parse-workbook.ts out/blocks.json [workbook.xlsx]
// Then:  bun scripts/dogforce-roster/load-into-sandbox.ts out/blocks.json out/ids.json [--apply]
// Sandbox tenant only (the loader refuses any other). First run: 23 Sep 2026.
// Parse DogForce's manual roster workbook into blocks: one per "NAMES OF GUARDS" header.
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "fs";
const wb = XLSX.read(readFileSync(process.argv[3] ?? "C:/Users/phili/Downloads/GUARD ROASTER 21 AUGUST -20 SEPT 2026.xlsx"));
const WORK = /^(DS|NS|OFF|L|STBY)$/;
const isNoise = (t: string) =>
  /2026|20[0-9]{2}|SEPT|OCTOBER|AUGUST|DECEMBER|NOVEMBER|MEANS|STANDBY|^STBY|^SHOP ?RITE$|^HRS$|^D$|^&$|^OFF$|^NUWN$|^MG$|HOURS|^24|NIGHT SHIFT|=/i.test(t) || /^\d+$/.test(t);
const blocks: any[] = [];
for (const sheet of wb.SheetNames) {
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "", blankrows: true });
  let metaStart = 0;
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i][0]).trim().toUpperCase();
    if (!/^NAMES? OF (THE )?GUARDS/.test(a)) continue;
    const meta = rows.slice(metaStart, i);
    let siteName = "", service = "", needed: number | null = null, allocated: number | null = null;
    const free: string[] = [];
    for (const r of meta) {
      const k = String(r[0]).trim().toUpperCase();
      const rest = r.slice(1).map((c) => String(c).replace(/\s+/g, " ").trim()).filter(Boolean);
      if (k.startsWith("SITE NAME")) { if (rest[0] && !isNoise(rest[0])) siteName = rest[0]; free.push(...rest.slice(1)); }
      else if (k.startsWith("TYPE OF SERVICE")) { service = String(r[1]).trim(); free.push(...rest.slice(1)); }
      else if (k.startsWith("NUMBER OF GUARD")) { needed = Number(r[1]) || null; free.push(...rest.slice(1)); }
      else if (k.startsWith("OFFICERS ALLOC")) { allocated = Number(r[1]) || null; free.push(...rest.slice(1)); }
      else if (!r.slice(1, 31).some((c) => WORK.test(String(c).trim().toUpperCase()))) free.push(...[String(r[0]).trim(), ...rest].filter(Boolean));
    }
    const cand = free.filter((t) => !isNoise(t));
    if (!siteName) siteName = cand.join(" ");
    // day columns from this block's own header
    const header = rows[i];
    const cols: { col: number; day: number }[] = [];
    for (let c = 1; c <= 31; c++) { const d = Number(header[c]); if (Number.isInteger(d) && d >= 1 && d <= 31) cols.push({ col: c, day: d }); }
    // map day numbers to dates: sequence starts on the 21st of month M and wraps
    const has31 = cols.some((x) => x.day === 31);
    const startMonth = has31 ? 8 : 9; // Aug-Sep has a 31st; Sep-Oct doesn't
    let month = startMonth, prev = 0; const seen = new Set<string>();
    const dates = cols.map((x) => { if (x.day < prev) month++; prev = x.day; const iso = `2026-${String(month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`; const dup = seen.has(iso); seen.add(iso); return { col: x.col, iso: dup ? null : iso }; });
    // guard rows until next metadata/header
    const guards: any[] = [];
    let j = i + 1;
    for (; j < rows.length; j++) {
      const r = rows[j]; const name = String(r[0]).replace(/\s+/g, " ").trim();
      const k = name.toUpperCase();
      if (/^(SITE NAME|TYPE OF SERVICE|NUMBER OF GUARD|OFFICERS ALLOC|NAMES? OF)/.test(k)) break;
      const cells = dates.map((d) => ({ iso: d.iso, code: String(r[d.col]).replace(/\s+/g, "").toUpperCase() }));
      if (!name || name === "X") continue;
      if (!cells.some((c) => c.code)) continue;
      guards.push({ name, cells: cells.filter((c) => c.iso && c.code) });
    }
    blocks.push({ sheet, row: i, siteName, service, needed, allocated, period: has31 ? "2026-08-21..2026-09-20" : "2026-09-21..2026-10-20", guards });
    metaStart = j;
  }
}
writeFileSync(process.argv[2], JSON.stringify(blocks));
for (const [n, b] of blocks.entries()) console.log(`${n} [${b.sheet}@${b.row}] "${b.siteName}" :: ${b.service || "-"} :: need ${b.needed} :: ${b.period} :: guards ${b.guards.length}`);
