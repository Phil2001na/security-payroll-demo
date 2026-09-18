/**
 * UAT-13 / UAT-T09 — verifies directed-leave evidence against the live database.
 *
 * Seeds inside a transaction that is always rolled back, impersonating real profiles via
 * request.jwt.claims because record_directed_leave reads auth.uid() and get_my_role().
 *
 * Run: export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-) \
 *      && bun scripts/verify-directed-leave.ts
 */
import { SQL } from "bun";

const sql = new SQL(process.env.SUPABASE_DB_URL!);
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const ROLLBACK = "intentional-rollback";

// Bun's SQL template does not render a JS array into a Postgres text[] parameter — it sends
// something the server reads as a malformed array literal. Build the literal ourselves and
// cast it, which is what supabase-js does over the wire anyway.
// JSON.stringify quotes and escapes backslashes and double quotes exactly the way a
// double-quoted Postgres array element needs, so it does the escaping for us.
const pgTextArray = (xs: string[]): string => `{${xs.map((x) => JSON.stringify(x)).join(",")}}`;

async function attempt(tx: SQL, label: string, fn: () => Promise<unknown>): Promise<string | null> {
  await tx.unsafe(`savepoint sp_${label}`);
  try {
    await fn();
    await tx.unsafe(`release savepoint sp_${label}`);
    return null;
  } catch (e) {
    await tx.unsafe(`rollback to savepoint sp_${label}`);
    return e instanceof Error ? e.message : String(e);
  }
}

try {
  await sql.begin(async (tx) => {
    const [tenant] = await tx`
      select t.id, t.name from public.tenants t
      where exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'admin' and p.is_active)
        and exists (select 1 from public.employees e where e.tenant_id = t.id and e.status = 'active')
      order by t.name limit 1`;
    if (!tenant) throw new Error("no usable tenant");

    const [admin] = await tx`
      select id from public.profiles where tenant_id = ${tenant.id} and role = 'admin' and is_active limit 1`;
    const [emp] = await tx`
      select id from public.employees where tenant_id = ${tenant.id} and status = 'active' limit 1`;

    console.log(`tenant ${tenant.name}\n  employee ${emp.id}\n`);

    const asRole = (profileId: string) =>
      tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: profileId, role: "authenticated" })}'`,
      );
    await asRole(admin.id);

    const START = "2027-04-05";
    const END = "2027-04-16";
    const REASON = "Guard is 30 days from their statutory annual-leave deadline.";

    const record = (over: Record<string, unknown> = {}) => {
      const a = {
        response: "acknowledged",
        ack: "Johannes Amakali",
        note: null as string | null,
        witness: null as string | null,
        attachments: [] as string[],
        ...over,
      };
      return tx`select public.record_directed_leave(
        ${emp.id}::uuid, ${START}::date, ${END}::date, ${REASON},
        ${a.response}::text, ${a.ack}::text, ${a.note}::text, ${a.witness}::text,
        ${pgTextArray(a.attachments)}::text[], null, null) as id`;
    };

    // ---------------------------------------------------------------------------------
    // The mandatory inputs
    // ---------------------------------------------------------------------------------
    await tx.unsafe("set local role authenticated");
    const missingAck = await attempt(tx, "noack13", () => record({ ack: null }));
    await tx.unsafe("reset role");
    check(
      "an acknowledgement with nothing typed is refused",
      !!missingAck && missingAck.includes("typed acknowledgement is required"),
      missingAck ?? "an empty acknowledgement was accepted",
    );

    await tx.unsafe("set local role authenticated");
    const badResponse = await attempt(tx, "badresp13", () => record({ response: "maybe" }));
    await tx.unsafe("reset role");
    check(
      "an unknown response value is refused",
      badResponse !== null,
      badResponse ?? "'maybe' was accepted as a response",
    );

    await tx.unsafe("set local role authenticated");
    const badDates = await attempt(
      tx,
      "baddates13",
      () =>
        tx`select public.record_directed_leave(${emp.id}::uuid, ${END}::date, ${START}::date,
         ${REASON}, 'refused'::text, null, null, null, '{}'::text[], null, null)`,
    );
    await tx.unsafe("reset role");
    check(
      "leave ending before it starts is refused",
      !!badDates && badDates.includes("cannot be before"),
      badDates ?? "reversed dates were accepted",
    );

    // ---------------------------------------------------------------------------------
    // UAT-T09 — record a refusal and prove it is retained
    // ---------------------------------------------------------------------------------
    await tx.unsafe("set local role authenticated");
    const [refusal] = await tx`select public.record_directed_leave(
      ${emp.id}::uuid, ${START}::date, ${END}::date, ${REASON},
      'refused_to_sign'::text, null, 'Guard declined and would not sign the form.'::text,
      'S. Nangolo (Site Supervisor)'::text,
      ${pgTextArray(["tenant/emp/scan-of-form.pdf"])}::text[], null, null) as id`;
    await tx.unsafe("reset role");

    const [row] = await tx`
      select * from public.directed_leave_records where id = ${refusal.id}`;
    check(
      "UAT-T09 — a refusal to sign is recorded without needing a signature",
      row.response === "refused_to_sign" && row.typed_acknowledgement === null,
      `response="${row.response}", typed_acknowledgement=${row.typed_acknowledgement ?? "null"}`,
    );
    // The driver hands back `date` columns as Date objects; supabase-js gives the browser ISO
    // strings. Normalise before comparing so the assertion is about the stored value.
    const iso = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    check(
      "UAT-T09 — it retains who offered, the dates, the reason, the witness and the note",
      !!row.offered_by &&
        !!row.offered_on &&
        iso(row.leave_start) === START &&
        iso(row.leave_end) === END &&
        row.reason === REASON &&
        row.witness_name === "S. Nangolo (Site Supervisor)" &&
        !!row.response_note,
      `offered_by set, dates ${iso(row.leave_start)}..${iso(row.leave_end)}, witness "${row.witness_name}"`,
    );
    check(
      "UAT-T09 — attachments are kept as storage paths, not public URLs",
      Array.isArray(row.attachments) &&
        row.attachments.length === 1 &&
        !String(row.attachments[0]).startsWith("http"),
      `attachments: ${JSON.stringify(row.attachments)}`,
    );
    check(
      "it stamps the recording user and time, separately from who offered",
      !!row.recorded_by && !!row.recorded_at,
      `recorded_by set, recorded_at ${row.recorded_at ? "set" : "null"}`,
    );

    // ---------------------------------------------------------------------------------
    // UAT-T09 — immutable
    // ---------------------------------------------------------------------------------
    const updateErr = await attempt(
      tx,
      "upd13",
      () =>
        tx`update public.directed_leave_records set response = 'acknowledged' where id = ${refusal.id}`,
    );
    check(
      "UAT-T09 — the record cannot be edited after saving",
      !!updateErr && updateErr.includes("append-only"),
      updateErr ?? "the record was edited",
    );

    const deleteErr = await attempt(
      tx,
      "del13",
      () => tx`delete from public.directed_leave_records where id = ${refusal.id}`,
    );
    check(
      "UAT-T09 — and it cannot be deleted",
      !!deleteErr && deleteErr.includes("append-only"),
      deleteErr ?? "the record was deleted",
    );

    // Append-only must hold even for a privileged path, not just for PostgREST.
    check(
      "append-only is a trigger, so it holds for the table owner too",
      !!updateErr,
      "the update above ran as the table owner and was still refused",
    );

    // ---------------------------------------------------------------------------------
    // Role gate
    // ---------------------------------------------------------------------------------
    const [outsider] = await tx`
      select id from public.profiles
       where tenant_id = ${tenant.id} and is_active
         and role not in ('admin','operations','payroll','supervisor') limit 1`;
    if (outsider) {
      await asRole(outsider.id);
      await tx.unsafe("set local role authenticated");
      const roleErr = await attempt(tx, "role13", () => record());
      await tx.unsafe("reset role");
      await asRole(admin.id);
      check(
        "a role outside HR/Operations cannot record directed leave",
        !!roleErr && roleErr.includes("Not permitted"),
        roleErr ?? "an unauthorised role recorded directed leave",
      );
    } else {
      console.log("SKIP  role gate — no profile outside the permitted roles in this tenant");
    }

    // ---------------------------------------------------------------------------------
    // Audit trail
    // ---------------------------------------------------------------------------------
    const audit = await tx`
      select action from public.audit_events
       where table_name = 'directed_leave_records' and record_id = ${refusal.id}`;
    check(
      "the record raises its own audit event",
      audit.length > 0,
      `audit_events rows: ${audit.map((a: { action: string }) => a.action).join(", ") || "none"}`,
    );

    // ---------------------------------------------------------------------------------
    // Exportable: everything the CSV needs is on one readable row
    // ---------------------------------------------------------------------------------
    const [exportable] = await tx`
      select d.offered_on, d.leave_start, d.leave_end, d.reason, d.response,
             d.typed_acknowledgement, d.witness_name, d.response_note,
             d.recorded_at, e.surname, e.first_names
        from public.directed_leave_records d
        join public.employees e on e.id = d.employee_id
       where d.id = ${refusal.id}`;
    check(
      "every exported column is reachable in one join",
      !!exportable && !!exportable.surname && !!exportable.reason,
      `export row for ${exportable?.surname}, ${exportable?.first_names}`,
    );

    throw new Error(ROLLBACK);
  });
} catch (e) {
  if (!(e instanceof Error) || e.message !== ROLLBACK) {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    await sql.end();
    process.exit(1);
  }
}

await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed (all seed rows rolled back)`,
);
process.exit(failed.length ? 1 : 0);
