// Load DogForce's manual roster workbook into the DogForce Sandbox tenant ONLY.
// Usage: bun load.ts blocks.json ids.json [--apply]
import { SQL } from "bun";
import { readFileSync, writeFileSync } from "fs";
const APPLY = process.argv.includes("--apply");
const sql = new SQL(process.env.SUPABASE_DB_URL! + "?sslmode=require");
const TID = "dee49ef9-c4fd-4579-9970-d57d292fcf66";
const [ten]: any[] = await sql`select name from tenants where id=${TID}`;
if (!ten || !/sandbox/i.test(ten.name)) throw new Error("refusing: target tenant is not the sandbox");

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
// Site blocks: drop the stale duplicate China Seventh copy, fold "Magnolia" into Magnolia Industry.
const NAME_FIX: Record<string, string> = {
  "EMERINCIA POLT": "Emerincia Plot",
  "SCRAP SOUHTERN": "Scrap Southern",
  "WAKKA PRE -PRIMARY": "Wakka Pre-Primary",
  "BONSMARA SERVICES STATION": "Bonsmara Service Station",
  "NEW ERA HEAD OFFICER, WARE HOUSE & SHOP": "New Era Head Office, Warehouse & Shop",
  "NEW ERA CENTERAL HOSPITAL": "New Era Central Hospital & State House",
  "CHINA SEVETH RAILWAY": "China Seventh Railway",
  Magnolia: "Magnolia Industry",
  "AFRIDECA & OVER SIDE GROUP": "Afrideca & Overside Group",
  "HOCHLAND S S": "Hochland S S",
  "C C - HUB": "C C Hub",
  "NAMIC NO.2 & 3": "Namic No. 2 & 3",
  NAPWU: "NAPWU",
};
const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const blocks = raw
  .filter((b: any) => !(b.sheet === "CHINA SEVETH" && b.row === 3))
  .map((b: any) => ({ ...b, site: NAME_FIX[b.siteName] ?? title(b.siteName) }));
const siteNames = [...new Set(blocks.map((b: any) => b.site))] as string[];

// Names -> employees. Several spellings may map to one person (a guard listed on two sheets).
const toks = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Spelling-tolerant token match; a lone initial ("H") matches any token starting with it.
const sound = (s: string) => s.replace(/ph/g, "f").replace(/th/g, "t").replace(/y/g, "i").replace(/(.)\1+/g, "$1");
const close = (a: string, b: string) => {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const x = sound(a), y = sound(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && lev(x, y) <= (Math.max(x.length, y.length) >= 7 ? 2 : 1));
};
const sameName = (rt: string[], et: string[], surname: string[]) => {
  const pool = [...et];
  for (const t of rt) {
    const k = pool.findIndex((p) => close(t, p));
    if (k < 0) return false;
    pool.splice(k, 1);
  }
  return surname.some((x) => rt.some((t) => close(t, x)));
};
const emps: any[] = await sql`select id, employee_code, surname, first_names from employees where tenant_id=${TID}`;
const names = [...new Set(blocks.flatMap((b: any) => b.guards.map((g: any) => g.name)))] as string[];
const nameToEmp = new Map<string, string>(); // roster name -> employee id, or "new:<key>"
const newPeople: { key: string; surname: string; first: string }[] = [];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
for (const n of names) {
  const rt = toks(n);
  const e = emps.find((e) => sameName(rt, toks(`${e.surname} ${e.first_names}`), toks(e.surname)));
  if (e) {
    nameToEmp.set(n, e.id);
    continue;
  }
  const twin = newPeople.find(
    (p) =>
      sameName(rt, toks(`${p.surname} ${p.first}`), toks(p.surname)) ||
      sameName(toks(`${p.surname} ${p.first}`), rt, [rt[0]]),
  );
  if (twin) {
    nameToEmp.set(n, `new:${twin.key}`);
    continue;
  }
  const clean = n.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  const [sur, ...rest] = clean.split(" ");
  const p = { key: clean.toLowerCase(), surname: cap(sur), first: rest.map(cap).join(" ") || "-" };
  newPeople.push(p);
  nameToEmp.set(n, `new:${p.key}`);
}

// Cells, home site, preferred shift.
type Cell = { person: string; site: string; date: string; code: string };
const cells: Cell[] = [];
for (const b of blocks)
  for (const g of b.guards)
    for (const c of g.cells) cells.push({ person: nameToEmp.get(g.name)!, site: b.site, date: c.iso, code: c.code });
const stats = new Map<string, { sites: Map<string, number>; ds: number; ns: number }>();
for (const c of cells) {
  if (!["DS", "NS", "STBY"].includes(c.code)) continue;
  const s = stats.get(c.person) ?? { sites: new Map(), ds: 0, ns: 0 };
  stats.set(c.person, s);
  s.sites.set(c.site, (s.sites.get(c.site) ?? 0) + 1);
  if (c.code === "DS") s.ds++;
  if (c.code === "NS") s.ns++;
}
const firstSiteOf = (p: string) =>
  blocks.find((b: any) => b.guards.some((g: any) => nameToEmp.get(g.name) === p))?.site as string;
const homeOf = (p: string) => {
  const s = stats.get(p);
  if (!s || !s.sites.size) return firstSiteOf(p);
  return [...s.sites].sort((a, b) => b[1] - a[1])[0][0];
};
const prefOf = (p: string) => {
  const s = stats.get(p);
  const t = s ? s.ds + s.ns : 0;
  if (!s || !t) return "both";
  return s.ns / t >= 0.75 ? "night" : s.ds / t >= 0.75 ? "day" : "both";
};

// Requirements: per site / day of week / kind, the most common on-duty count in their sheet.
const daily = new Map<string, number>();
const seenCell = new Set<string>();
for (const c of cells) {
  if (c.code !== "DS" && c.code !== "NS") continue;
  const k = `${c.person}|${c.date}`;
  if (seenCell.has(k)) continue;
  seenCell.add(k);
  const key = `${c.site}|${c.date}|${c.code === "DS" ? "day" : "night"}`;
  daily.set(key, (daily.get(key) ?? 0) + 1);
}
const siteDates = new Map<string, Set<string>>();
for (const b of blocks) {
  const s = siteDates.get(b.site) ?? new Set<string>();
  for (const g of b.guards) for (const c of g.cells) s.add(c.iso);
  siteDates.set(b.site, s);
}
const reqs: { site: string; dow: number; kind: string; qty: number }[] = [];
for (const site of siteNames)
  for (const kind of ["day", "night"])
    for (let dow = 0; dow < 7; dow++) {
      const counts = [...(siteDates.get(site) ?? [])]
        .filter((d) => new Date(d + "T00:00:00Z").getUTCDay() === dow)
        .map((d) => daily.get(`${site}|${d}|${kind}`) ?? 0);
      if (!counts.length) continue;
      const freq = new Map<number, number>();
      counts.forEach((n) => freq.set(n, (freq.get(n) ?? 0) + 1));
      const mode = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
      if (mode > 0) reqs.push({ site, dow, kind, qty: mode });
    }

const matchedIds = new Set([...nameToEmp.values()].filter((v) => !v.startsWith("new:")));
const codeCount = new Map<string, number>();
cells.forEach((c) => codeCount.set(c.code, (codeCount.get(c.code) ?? 0) + 1));
console.log(`sites ${siteNames.length}: ${siteNames.join(" | ")}`);
console.log(`people: matched ${matchedIds.size}, new ${newPeople.length}, sandbox staff to suspend ${emps.length - matchedIds.size}`);
console.log("cells by code", Object.fromEntries(codeCount));
console.log(
  "Wednesday need (day/night):",
  siteNames
    .map((s) => `${s} ${["day", "night"].map((k) => reqs.find((r) => r.site === s && r.kind === k && r.dow === 3)?.qty ?? 0).join("/")}`)
    .join(" · "),
);
console.log("new people:", newPeople.map((p) => `${p.surname}, ${p.first}`).join(" | "));
if (!APPLY) {
  await sql.end();
  process.exit(0);
}

// ================= APPLY =================
await sql.begin(async (tx) => {
  await tx`update tenants set name = 'DogForce Security Services (Sandbox)' where id = ${TID}`;
  const [stby]: any[] = await tx`select id from shift_types where tenant_id=${TID} and code='STBY'`;
  if (!stby)
    await tx`insert into shift_types (tenant_id, code, label, day_of_week, period, default_hours, pay_rule, rate_multiplier, is_premium, is_leave, active)
             values (${TID}, 'STBY', 'Standby', 'any', 'full_day', 0, 'off', 0, false, false, true)`;
  const existing: any[] = await tx`select id, code from sites where tenant_id=${TID} order by code`;
  const siteId = new Map<string, string>();
  for (const [i, name] of siteNames.entries()) {
    if (i < existing.length) {
      await tx`update sites set name=${name}, notes='Loaded from DogForce roster workbook, 23 Sep 2026', active=true where id=${existing[i].id}`;
      siteId.set(name, existing[i].id);
    } else {
      const [r]: any[] = await tx`insert into sites (tenant_id, name, code, notes, active)
        values (${TID}, ${name}, ${"DFS" + String(i + 1).padStart(2, "0")}, 'Loaded from DogForce roster workbook, 23 Sep 2026', true) returning id`;
      siteId.set(name, r.id);
    }
  }
  for (const s of existing.slice(siteNames.length)) await tx`update sites set active=false where id=${s.id}`;
  await tx`delete from site_requirements where tenant_id=${TID}`;
  for (const r of reqs)
    await tx`insert into site_requirements (tenant_id, site_id, day_of_week, shift_kind, quantity_required)
             values (${TID}, ${siteId.get(r.site)}, ${r.dow}, ${r.kind}, ${r.qty})`;

  const [tmpl]: any[] = await tx`select id from employees where tenant_id=${TID} and position='security_officer' order by employee_code limit 1`;
  let next = 186;
  const personId = new Map<string, string>();
  for (const v of matchedIds) personId.set(v, v);
  for (const p of newPeople) {
    const code = "DF" + String(next++).padStart(3, "0");
    const [r]: any[] = await tx`insert into employees
      select (jsonb_populate_record(null::employees, to_jsonb(e) || jsonb_build_object(
        'id', gen_random_uuid(), 'employee_code', ${code}::text, 'surname', ${p.surname}::text, 'first_names', ${p.first}::text,
        'display_name', null, 'national_id', null, 'sesorb_registration_number', null, 'bank_name', null,
        'bank_account_number', null, 'phone', null, 'email', null, 'photo_url', null,
        'contract_signed_at', null, 'contract_signed_pdf_url', null, 'created_at', now(), 'updated_at', now()))).*
      from employees e where e.id = ${tmpl.id} returning id`;
    personId.set(`new:${p.key}`, r.id);
  }
  const rostered = new Set<string>();
  for (const key of new Set(nameToEmp.values())) {
    const id = personId.get(key)!;
    rostered.add(id);
    await tx`update employees set status='active', home_site_id=${siteId.get(homeOf(key)) ?? null}, preferred_shift=${prefOf(key)}
             where id=${id}`;
  }
  const off = emps.filter((e) => !rostered.has(e.id)).map((e) => e.id);
  if (off.length) await tx`update employees set status='suspended' where id in ${tx(off)}`;
  await tx`insert into pay_periods (tenant_id, label, start_date, end_date, pay_date, status)
           select ${TID}, 'October 2026 SANDBOX (21 Sep - 20 Oct)', '2026-09-21', '2026-10-20', '2026-11-16', 'open'
           where not exists (select 1 from pay_periods where tenant_id=${TID} and start_date='2026-09-21')`;
  await tx`delete from schedule_assignments where tenant_id=${TID} and date between '2026-08-21' and '2026-10-20'`;
  writeFileSync(process.argv[3], JSON.stringify({ personId: [...personId], siteId: [...siteId] }));
});
console.log("setup committed");

// Shifts one at a time, so the database's legal checks accept or refuse each on its own.
const saved = JSON.parse(readFileSync(process.argv[3], "utf8"));
const ids = new Map<string, string>(saved.personId);
const sites = new Map<string, string>(saved.siteId);
const st: any[] = await sql`select id, code from shift_types where tenant_id=${TID} and code in ('DAY','NIGHT','STBY')`;
const stId = Object.fromEntries(st.map((r) => [r.code, r.id]));
const report = { refused: [] as any[], skipped: {} as Record<string, number>, duplicates: 0 };
const placed = new Set<string>();
const ordered = [...cells].sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person));
let ok = 0;
for (const c of ordered) {
  const type = c.code === "DS" ? "DAY" : c.code === "NS" ? "NIGHT" : c.code === "STBY" ? "STBY" : null;
  if (!type) {
    report.skipped[c.code] = (report.skipped[c.code] ?? 0) + 1;
    continue;
  }
  const emp = ids.get(c.person)!;
  const k = `${emp}|${c.date}`;
  if (placed.has(k)) {
    report.duplicates++;
    continue;
  }
  try {
    await sql`insert into schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
              values (${TID}, ${emp}, ${sites.get(c.site)}, ${c.date}, ${stId[type]}, ${type === "STBY" ? 0 : 12})`;
    placed.add(k);
    ok++;
  } catch (e: any) {
    report.refused.push({ person: emp, site: c.site, date: c.date, code: c.code, reason: e.message });
  }
}
const reasons = new Map<string, number>();
for (const r of report.refused) {
  const key = r.reason.replace(/\d+(\.\d+)?/g, "#").slice(0, 120);
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log(`placed ${ok}; refused ${report.refused.length}; same-day duplicates ${report.duplicates}; skipped`, report.skipped);
console.log([...reasons].sort((a, b) => b[1] - a[1]));
writeFileSync(process.argv[3].replace(".json", "-report.json"), JSON.stringify(report));
await sql.end();
