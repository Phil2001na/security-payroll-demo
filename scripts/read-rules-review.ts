// Read what the client has written into the business-rules review page.
//   export SUPABASE_DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d= -f2-)
//   bun scripts/read-rules-review.ts
import { SQL } from "bun";

const sql = new SQL(process.env.SUPABASE_DB_URL! + "?sslmode=require");

const rows: any[] = await sql`
  select v.label, r.reviewer_name, r.reviewer_id, r.section_key, r.mark, r.note, r.updated_at
  from rules_review.responses r
  join rules_review.reviews v on v.token = r.token
  order by v.label, r.reviewer_name nulls last, r.section_key`;

if (!rows.length) {
  console.log("No responses yet.");
} else {
  let who = "";
  for (const r of rows) {
    const label = `${r.label} — ${r.reviewer_name ?? "(unnamed)"} [${r.reviewer_id.slice(0, 8)}]`;
    if (label !== who) {
      who = label;
      console.log(`\n${"=".repeat(label.length)}\n${label}\n${"=".repeat(label.length)}`);
    }
    console.log(`\n${(r.mark ?? "NOTE").toUpperCase()}  —  ${r.section_key}`);
    if (r.note) console.log(r.note.split("\n").map((l: string) => "    " + l).join("\n"));
  }
  console.log(`\n\n${rows.length} response${rows.length === 1 ? "" : "s"}.`);
}
await sql.end();
