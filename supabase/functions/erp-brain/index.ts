import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const MODEL_PROVIDER = "gemini";

function buildSystemPrompt(companyName: string): string {
  return `You are the executive intelligence assistant for ${companyName}'s ERP system — a security workforce, payroll and accounting platform.

Your role: Help the executive understand the current state of the business through clear, concise analysis of live payroll, operations, and financial data. You see headcount, scheduling/attendance anomalies (with employee and site names), disciplinary matters, per-period payroll totals, leave liability, the full general ledger (revenue, expenses, cash, receivables, payables) including a month-by-month breakdown, and invoicing.

When asked about trends or comparisons over time, use the monthly financial breakdown. When asked for a trend chart, chart the monthly figures.

STRICT CONSTRAINTS:
- READ-ONLY. You cannot and must not modify data; you may recommend actions for a human to take.
- FACTUAL. Only use data provided in this conversation. Never fabricate or estimate figures — if a number isn't in the snapshot, say it isn't available.
- HONEST. If you lack data to answer a question, say so explicitly.

RESPONSE STYLE:
- Lead with the direct answer.
- Be concise and executive-focused. 2–4 paragraphs max unless a detailed breakdown is requested.
- Format money as NAD X,XXX.XX.
- Use plain prose. Use **bold** only for key figures or critical flags.
- Proactively connect the dots across domains (e.g. payroll cost vs. revenue, overdue receivables vs. cash) and flag risks the data reveals.

TOOLS:
You have a data lookup tool and three document tools.
- query_employee_detail: Look up one named employee's payslip, attendance/shift history, leave balance, disciplinary history, or profile. The snapshot above only has aggregate/company-wide data — use this tool whenever the question is about a SPECIFIC named individual and the answer isn't already in the snapshot. You may call it more than once (e.g. once per employee) before answering.
- generate_pdf_report: Formatted PDF report with sections and tables. Use when the user asks for a report, document, printable summary.
- generate_excel: Excel spreadsheet with one or more sheets. Use when the user asks for a spreadsheet, Excel file, or data export.
- generate_chart: Inline chart rendered in the conversation. Use when the user asks for a chart, graph, or visual breakdown.

When calling a document tool, ALWAYS include a short text message first explaining what you are generating.`;
}

const QUERY_TOOL_NAME = "query_employee_detail";

const TOOLS = [
  {
    name: QUERY_TOOL_NAME,
    description:
      "Look up detailed, tenant-scoped records for ONE named employee. Use this before answering any question about a specific individual (e.g. 'what did John's payslip look like', 'has Maria been disciplined', 'what's Peter's leave balance', 'show Sam's attendance'). Returns a text summary; call again with a different employee_name if the question involves multiple people.",
    input_schema: {
      type: "object",
      properties: {
        employee_name: {
          type: "string",
          description: "The employee's name as mentioned by the user (full name or partial, e.g. 'John' or 'John Shikongo').",
        },
        detail: {
          type: "string",
          enum: ["payslip", "attendance", "leave", "disciplinary", "profile"],
          description:
            "payslip = pay period gross/net/deductions breakdown; attendance = recent shift log history; leave = annual/sick/compassionate/off day balances; disciplinary = disciplinary action history; profile = position, site, employment details.",
        },
        period_label: {
          type: "string",
          description: "Optional pay period label to scope a payslip lookup, e.g. 'July 2026'. If omitted, the most recent period is used.",
        },
      },
      required: ["employee_name", "detail"],
    },
  },
  {
    name: "generate_pdf_report",
    description:
      "Generate a formatted PDF report to download. Use when the user asks for a report, document, printable summary, or says 'give me a PDF'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Report title" },
        subtitle: { type: "string", description: "Optional subtitle or date range" },
        summary: { type: "string", description: "Executive summary paragraph shown at the top" },
        sections: {
          type: "array",
          description: "Report sections in order",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              body: { type: "string", description: "Optional prose paragraph for this section" },
              table: {
                type: "object",
                description: "Optional data table",
                properties: {
                  columns: { type: "array", items: { type: "string" } },
                  rows: {
                    type: "array",
                    items: { type: "array", items: { type: "string" } },
                  },
                },
                required: ["columns", "rows"],
              },
            },
            required: ["heading"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
  {
    name: "generate_excel",
    description:
      "Generate an Excel spreadsheet to download. Use when the user asks for a spreadsheet, Excel file, CSV, or data export.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Filename without extension" },
        sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Sheet tab name" },
              columns: { type: "array", items: { type: "string" } },
              rows: {
                type: "array",
                items: { type: "array", items: { type: "string" } },
              },
            },
            required: ["name", "columns", "rows"],
          },
        },
      },
      required: ["filename", "sheets"],
    },
  },
  {
    name: "generate_chart",
    description:
      "Render a chart inline in the conversation. Use when the user asks for a chart, graph, or visual breakdown of data.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "pie", "area"],
          description: "Chart type",
        },
        title: { type: "string" },
        data: {
          type: "array",
          items: { type: "object" },
          description: "Array of data objects where each object is one data point",
        },
        x_key: { type: "string", description: "Key used for x-axis labels / pie slice names" },
        y_keys: {
          type: "array",
          items: { type: "string" },
          description: "Keys for data series (y values)",
        },
        colors: {
          type: "array",
          items: { type: "string" },
          description: "Optional hex color strings for each series",
        },
      },
      required: ["type", "title", "data", "x_key", "y_keys"],
    },
  },
];

const GEMINI_TOOLS = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function embedded(rel: unknown): Row | null {
  if (!rel) return null;
  return (Array.isArray(rel) ? rel[0] : rel) as Row;
}

function employeeName(rel: unknown): string {
  const e = embedded(rel);
  if (!e) return "unknown employee";
  return e.display_name || [e.first_names, e.surname].filter(Boolean).join(" ") || "unknown employee";
}

function buildContextBlock(
  data: {
    employees: Row[];
    payrollByPeriod: Array<{
      label: string; status: string; employees: number; gross: number; net: number;
    }>;
    openPeriod: Row | null;
    openDisciplinary: Row[];
    shiftAnomalies: Row[];
    sites: Row[];
    leaveTotals: { annual: number; sick: number } | null;
    financials: {
      revenue: number; expenses: number; profit: number; cash: number;
      arOutstanding: number; arOverdue: number; apOutstanding: number;
      draftAr: number; topClients: Array<{ name: string; amount: number }>;
      monthly: Array<{ month: string; revenue: number; expenses: number }>;
    } | null;
  },
  memories: Row[],
  today: string,
): string {
  const positionCounts: Record<string, number> = {};
  for (const e of data.employees) {
    positionCounts[e.position ?? "unknown"] = (positionCounts[e.position ?? "unknown"] ?? 0) + 1;
  }

  const lines: string[] = [
    `[CURRENT BUSINESS SNAPSHOT — ${today}]`,
    "",
    `Active employees: ${data.employees.length}`,
    ...Object.entries(positionCounts).map(([pos, n]) => `  ${pos}: ${n}`),
    "",
    `Active sites: ${data.sites.length}`,
    ...data.sites.map((s) => `  - ${s.name}`),
    "",
    `Open disciplinary actions: ${data.openDisciplinary.length}`,
    ...(data.openDisciplinary.length > 0
      ? data.openDisciplinary.map(
          (d) =>
            `  - ${employeeName(d.employees)}: ${d.action_type} (${d.offence_code}) on ${d.incident_date}`,
        )
      : []),
    "",
  ];

  if (data.openPeriod) {
    lines.push(
      `Current open pay period: ${data.openPeriod.label} (${data.openPeriod.start_date} – ${data.openPeriod.end_date})`,
    );
  } else {
    lines.push("No open pay period.");
  }

  if (data.payrollByPeriod.length > 0) {
    const n = (v: number) => `NAD ${v.toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    lines.push("", "Payroll totals per pay period (whole company, most recent first):");
    for (const p of data.payrollByPeriod) {
      lines.push(
        `  - ${p.label} (${p.status}): ${p.employees} employees, gross ${n(p.gross)}, net ${n(p.net)}`,
      );
    }
  }

  if (data.leaveTotals) {
    lines.push(
      "",
      `Leave liability across active employees: ${data.leaveTotals.annual.toFixed(1)} annual days, ${data.leaveTotals.sick.toFixed(1)} sick days accrued.`,
    );
  }

  if (data.shiftAnomalies.length > 0) {
    lines.push(
      "",
      `Shift anomalies (last 14 days, non-approved): ${data.shiftAnomalies.length} records`,
    );
    const bySite: Record<string, Row[]> = {};
    for (const s of data.shiftAnomalies) {
      const siteName = embedded(s.sites)?.name ?? "Unknown site";
      (bySite[siteName] ??= []).push(s);
    }
    for (const [site, rows] of Object.entries(bySite)) {
      lines.push(`  ${site}: ${rows.length}`);
      for (const r of rows) {
        lines.push(`    - ${r.date} ${employeeName(r.employees)}: ${r.status}`);
      }
    }
  } else {
    lines.push("", "No shift anomalies in the last 14 days.");
  }

  const f = data.financials;
  if (f) {
    const n = (v: number) => `NAD ${v.toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    lines.push(
      "",
      "[FINANCIAL POSITION — from the live general ledger]",
      `  Revenue (to date): ${n(f.revenue)}`,
      `  Expenses (to date): ${n(f.expenses)}`,
      `  Net profit/(loss): ${n(f.profit)}`,
      `  Cash at bank: ${n(f.cash)}`,
      `  Accounts receivable outstanding (issued, unpaid): ${n(f.arOutstanding)} — of which ${n(f.arOverdue)} is past due`,
      `  Draft AR not yet issued: ${n(f.draftAr)}`,
      `  Accounts payable outstanding (approved bills to pay): ${n(f.apOutstanding)}`,
    );
    if (f.topClients.length > 0) {
      lines.push("  Largest outstanding receivables:");
      for (const c of f.topClients) lines.push(`    - ${c.name}: ${n(c.amount)}`);
    }
    if (f.monthly.length > 0) {
      lines.push("  Month-by-month (revenue / expenses / net):");
      for (const m of f.monthly) {
        lines.push(`    - ${m.month}: ${n(m.revenue)} / ${n(m.expenses)} / ${n(m.revenue - m.expenses)}`);
      }
    }
  }

  if (memories.length > 0) {
    lines.push("", "[CEO PREFERENCES & FOCUS AREAS]");
    for (const m of memories) {
      lines.push(`  [${m.memory_type}] ${m.label}: ${m.content}`);
    }
  }

  return lines.join("\n");
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function fullName(e: Row): string {
  return e.display_name || [e.first_names, e.surname].filter(Boolean).join(" ");
}

async function findEmployeeByName(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  tenantId: string,
  nameQuery: string,
): Promise<{ match: Row | null; ambiguous: Row[] }> {
  const { data } = await adminClient
    .from("employees")
    .select("id, display_name, first_names, surname, position, category, status, start_date, home_site_id, hourly_rate, monthly_salary, sites:home_site_id(name)")
    .eq("tenant_id", tenantId);
  const employees = (data ?? []) as Row[];
  const needle = normalizeName(nameQuery);
  if (!needle) return { match: null, ambiguous: [] };

  const matches = employees.filter((e) => normalizeName(fullName(e)).includes(needle));
  if (matches.length === 1) return { match: matches[0], ambiguous: [] };
  if (matches.length > 1) return { match: null, ambiguous: matches };
  return { match: null, ambiguous: [] };
}

async function runEmployeeDetailQuery(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  tenantId: string,
  input: { employee_name?: string; detail?: string; period_label?: string },
): Promise<{ text: string; rowsExamined: number }> {
  const employeeName = (input.employee_name ?? "").trim();
  const detail = (input.detail ?? "").trim();
  if (!employeeName || !detail) {
    return { text: "Query failed: employee_name and detail are required.", rowsExamined: 0 };
  }

  const { match, ambiguous } = await findEmployeeByName(adminClient, tenantId, employeeName);
  if (ambiguous.length > 1) {
    return {
      text: `Ambiguous employee name "${employeeName}" — multiple matches: ${ambiguous.map(fullName).join(", ")}. Ask the user to clarify which one.`,
      rowsExamined: ambiguous.length,
    };
  }
  if (!match) {
    return { text: `No employee found matching "${employeeName}" in this tenant.`, rowsExamined: 0 };
  }

  const n = (v: number) => `NAD ${Number(v || 0).toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const name = fullName(match);

  if (detail === "profile") {
    const siteName = embedded(match.sites)?.name ?? "unassigned";
    const lines = [
      `[DETAIL: profile for ${name}]`,
      `Position: ${match.position}, category: ${match.category}, status: ${match.status}`,
      `Home site: ${siteName}`,
      `Start date: ${match.start_date ?? "unknown"}`,
      `Hourly rate: ${n(match.hourly_rate)}, monthly salary: ${n(match.monthly_salary)}`,
    ];
    return { text: lines.join("\n"), rowsExamined: 1 };
  }

  if (detail === "payslip") {
    let periodFilter: string | null = null;
    if (input.period_label) {
      const { data: periods } = await adminClient
        .from("pay_periods")
        .select("id, label")
        .eq("tenant_id", tenantId)
        .ilike("label", `%${input.period_label}%`)
        .limit(1);
      periodFilter = (periods as Row[] | null)?.[0]?.id ?? null;
      if (!periodFilter) {
        return { text: `No pay period found matching "${input.period_label}".`, rowsExamined: 0 };
      }
    }
    let query = adminClient
      .from("payroll_runs")
      .select(
        "gross_salary, net_salary, normal_amount, overtime_amount, sunday_amount, public_holiday_amount, night_premium_amount, transport_allowance, ssc_amount, paye_amount, other_statutory, consensual_deductions, total_deductions, status, pay_periods:pay_period_id(label, start_date, end_date)",
      )
      .eq("tenant_id", tenantId)
      .eq("employee_id", match.id)
      .order("generated_at", { ascending: false });
    query = periodFilter ? query.eq("pay_period_id", periodFilter) : query.limit(3);
    const { data } = await query;
    const runs = (data ?? []) as Row[];
    if (runs.length === 0) {
      return { text: `No payroll runs found for ${name}${input.period_label ? ` in ${input.period_label}` : ""}.`, rowsExamined: 0 };
    }
    const lines = [`[DETAIL: payslip history for ${name}]`];
    for (const r of runs) {
      const p = embedded(r.pay_periods);
      lines.push(
        `  ${p?.label ?? "unknown period"} (${r.status}): gross ${n(r.gross_salary)}, net ${n(r.net_salary)}`,
        `    breakdown — normal ${n(r.normal_amount)}, overtime ${n(r.overtime_amount)}, sunday ${n(r.sunday_amount)}, public holiday ${n(r.public_holiday_amount)}, night premium ${n(r.night_premium_amount)}, transport allowance ${n(r.transport_allowance)}`,
        `    deductions — SSC ${n(r.ssc_amount)}, PAYE ${n(r.paye_amount)}, other statutory ${n(r.other_statutory)}, consensual ${n(r.consensual_deductions)}, total ${n(r.total_deductions)}`,
      );
    }
    return { text: lines.join("\n"), rowsExamined: runs.length };
  }

  if (detail === "attendance") {
    const { data } = await adminClient
      .from("shift_logs")
      .select("date, status, hours_worked, night_hours, sites:site_id(name)")
      .eq("tenant_id", tenantId)
      .eq("employee_id", match.id)
      .order("date", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return { text: `No shift log records found for ${name}.`, rowsExamined: 0 };
    const lines = [`[DETAIL: last ${rows.length} shift logs for ${name}]`];
    for (const r of rows) {
      lines.push(`  ${r.date} ${embedded(r.sites)?.name ?? "unknown site"}: ${r.status}, ${r.hours_worked}h (${r.night_hours}h night)`);
    }
    return { text: lines.join("\n"), rowsExamined: rows.length };
  }

  if (detail === "leave") {
    const { data } = await adminClient
      .from("leave_balances")
      .select("annual_days, sick_days, compassionate_days, off_days")
      .eq("tenant_id", tenantId)
      .eq("employee_id", match.id)
      .maybeSingle();
    if (!data) return { text: `No leave balance record found for ${name}.`, rowsExamined: 0 };
    const b = data as Row;
    return {
      text: `[DETAIL: leave balance for ${name}]\n  Annual: ${b.annual_days} days, Sick: ${b.sick_days} days, Compassionate: ${b.compassionate_days} days, Off days: ${b.off_days}`,
      rowsExamined: 1,
    };
  }

  if (detail === "disciplinary") {
    const { data } = await adminClient
      .from("disciplinary_actions")
      .select("incident_date, action_type, offence_code, description, fine_amount, suspension_hours")
      .eq("tenant_id", tenantId)
      .eq("employee_id", match.id)
      .order("incident_date", { ascending: false })
      .limit(10);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return { text: `No disciplinary actions on record for ${name}.`, rowsExamined: 0 };
    const lines = [`[DETAIL: disciplinary history for ${name}]`];
    for (const r of rows) {
      lines.push(
        `  ${r.incident_date} — ${r.action_type} (${r.offence_code}): ${r.description}${r.fine_amount ? `, fine ${n(r.fine_amount)}` : ""}${r.suspension_hours ? `, suspension ${r.suspension_hours}h` : ""}`,
      );
    }
    return { text: lines.join("\n"), rowsExamined: rows.length };
  }

  return { text: `Unknown detail type "${detail}".`, rowsExamined: 0 };
}

const TOOL_MARKER = "<<<TOOL>>>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey || !geminiApiKey) {
      return jsonResponse({ error: "Missing required environment variables." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header." }, 401);
    }
    const jwt = authHeader.slice("Bearer ".length);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    const userId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await adminClient
      .from("profiles")
      .select("role, is_ceo_executive, is_active, tenant_id")
      .eq("id", userId)
      .maybeSingle();

    const hasAiAccess = profile?.is_active && (profile.is_ceo_executive || profile.role === "admin");
    if (!hasAiAccess) {
      return jsonResponse({ error: "Access denied. Executive assistant requires admin or executive access." }, 403);
    }

    const tenantId: string = profile.tenant_id;

    const body = (await req.json().catch(() => null)) as {
      message?: string;
      session_id?: string;
    } | null;
    const userMessage = body?.message?.trim();
    if (!userMessage) {
      return jsonResponse({ error: "message is required." }, 400);
    }

    let sessionId = body?.session_id ?? null;
    if (!sessionId) {
      const { data: newSession, error: sessionErr } = await adminClient
        .from("ai_conversation_sessions")
        .insert({
          tenant_id: tenantId,
          owner_user_id: userId,
          title: userMessage.slice(0, 80),
          model_provider: MODEL_PROVIDER,
          model_name: MODEL,
        })
        .select("id")
        .single();
      if (sessionErr || !newSession) {
        return jsonResponse({ error: "Failed to create conversation session." }, 500);
      }
      sessionId = newSession.id as string;
    } else {
      const { data: existingSession } = await adminClient
        .from("ai_conversation_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("owner_user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!existingSession) {
        return jsonResponse({ error: "Session not found or not authorized." }, 403);
      }
    }

    const [historyRes, memoriesRes] = await Promise.all([
      adminClient
        .from("ai_conversation_messages")
        .select("role, content")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(16),
      adminClient
        .from("ai_executive_memories")
        .select("memory_type, label, content")
        .eq("executive_user_id", userId)
        .eq("status", "active")
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(20),
    ]);

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const [
      employeesRes, recentPeriodsRes, openPeriodRes, disciplinaryRes, shiftsRes, sitesRes,
      tenantRes, ledgerRes, invoicesRes, leaveRes,
    ] = await Promise.all([
        adminClient
          .from("employees")
          .select("id, status, position")
          .eq("tenant_id", tenantId)
          .eq("status", "active"),
        adminClient
          .from("pay_periods")
          .select("id, label, status, start_date, end_date")
          .eq("tenant_id", tenantId)
          .order("start_date", { ascending: false })
          .limit(6),
        adminClient
          .from("pay_periods")
          .select("id, label, status, start_date, end_date")
          .eq("tenant_id", tenantId)
          .eq("status", "open")
          .maybeSingle(),
        adminClient
          .from("disciplinary_actions")
          .select(
            "id, employee_id, incident_date, action_type, offence_code, employees:employee_id(display_name, first_names, surname)",
          )
          .eq("tenant_id", tenantId)
          .order("incident_date", { ascending: false })
          .limit(20),
        adminClient
          .from("shift_logs")
          .select(
            "id, employee_id, site_id, date, status, hours_worked, employees:employee_id(display_name, first_names, surname), sites:site_id(name)",
          )
          .eq("tenant_id", tenantId)
          .gte("date", fourteenDaysAgo)
          .in("status", ["pending", "no_show", "suspended_unpaid"])
          .order("date", { ascending: false })
          .limit(30),
        adminClient
          .from("sites")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("name"),
        adminClient
          .from("tenants")
          .select("name, legal_name")
          .eq("id", tenantId)
          .maybeSingle(),
        adminClient
          .from("ledger_lines")
          .select("debit, credit, chart_of_accounts!inner(code, type), ledger_entries:ledger_id(entry_date)")
          .eq("tenant_id", tenantId),
        adminClient
          .from("invoices")
          .select("type, status, total, due_date, clients:client_id(name), vendors:vendor_id(name)")
          .eq("tenant_id", tenantId)
          .neq("status", "void"),
        adminClient
          .from("leave_balances")
          .select("annual_days, sick_days")
          .eq("tenant_id", tenantId),
      ]);

    // Aggregate payroll per pay period (payroll_runs rows are per employee).
    const recentPeriods = (recentPeriodsRes.data ?? []) as Row[];
    const periodIds = recentPeriods.map((p) => p.id as string);
    const payrollRunsRes = periodIds.length > 0
      ? await adminClient
          .from("payroll_runs")
          .select("pay_period_id, status, gross_salary, net_salary")
          .eq("tenant_id", tenantId)
          .in("pay_period_id", periodIds)
      : { data: [], error: null };

    const retrievalErrors: string[] = [];
    const checkRes = (label: string, err: { message: string } | null) => {
      if (err) {
        console.error(`erp-brain retrieval error [${label}]:`, err.message);
        retrievalErrors.push(`${label}: ${err.message}`);
      }
    };
    checkRes("employees", employeesRes.error);
    checkRes("payroll_runs", payrollRunsRes.error);
    checkRes("pay_periods", openPeriodRes.error ?? recentPeriodsRes.error);
    checkRes("disciplinary_actions", disciplinaryRes.error);
    checkRes("shift_logs", shiftsRes.error);
    checkRes("sites", sitesRes.error);
    checkRes("ledger_lines", ledgerRes.error);
    checkRes("invoices", invoicesRes.error);
    checkRes("leave_balances", leaveRes.error);

    // ----- derive financial position from the ledger + invoices -----
    let revenue = 0, expenses = 0, cash = 0;
    const monthlyMap: Record<string, { revenue: number; expenses: number }> = {};
    for (const l of (ledgerRes.data ?? []) as Row[]) {
      const acc = Array.isArray(l.chart_of_accounts) ? l.chart_of_accounts[0] : l.chart_of_accounts;
      const entry = Array.isArray(l.ledger_entries) ? l.ledger_entries[0] : l.ledger_entries;
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      const month = typeof entry?.entry_date === "string" ? entry.entry_date.slice(0, 7) : null;
      if (acc?.type === "income") {
        revenue += c - d;
        if (month) (monthlyMap[month] ??= { revenue: 0, expenses: 0 }).revenue += c - d;
      } else if (acc?.type === "expense") {
        expenses += d - c;
        if (month) (monthlyMap[month] ??= { revenue: 0, expenses: 0 }).expenses += d - c;
      }
      if (acc?.code === "1001") cash += d - c;
    }
    const monthly = Object.entries(monthlyMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, v]) => ({ month, revenue: v.revenue, expenses: v.expenses }));

    // Aggregate per-employee payroll rows into per-period company totals.
    const periodAgg: Record<string, { employees: number; gross: number; net: number }> = {};
    for (const r of (payrollRunsRes.data ?? []) as Row[]) {
      const agg = (periodAgg[r.pay_period_id] ??= { employees: 0, gross: 0, net: 0 });
      agg.employees += 1;
      agg.gross += Number(r.gross_salary || 0);
      agg.net += Number(r.net_salary || 0);
    }
    const payrollByPeriod = recentPeriods
      .filter((p) => periodAgg[p.id])
      .map((p) => ({
        label: p.label as string,
        status: p.status as string,
        ...periodAgg[p.id],
      }));

    let leaveTotals: { annual: number; sick: number } | null = null;
    if (leaveRes.data && leaveRes.data.length > 0) {
      leaveTotals = { annual: 0, sick: 0 };
      for (const b of leaveRes.data as Row[]) {
        leaveTotals.annual += Number(b.annual_days || 0);
        leaveTotals.sick += Number(b.sick_days || 0);
      }
    }
    let arOutstanding = 0, arOverdue = 0, apOutstanding = 0, draftAr = 0;
    const clientTotals: Record<string, number> = {};
    const todayStr = new Date().toISOString().split("T")[0];
    for (const inv of (invoicesRes.data ?? []) as Row[]) {
      const amt = Number(inv.total || 0);
      if (inv.type === "AR" && inv.status === "issued") {
        arOutstanding += amt;
        if (inv.due_date && inv.due_date < todayStr) arOverdue += amt;
        const client = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
        const name = client?.name ?? "Unknown client";
        clientTotals[name] = (clientTotals[name] ?? 0) + amt;
      } else if (inv.type === "AR" && inv.status === "draft") {
        draftAr += amt;
      } else if (inv.type === "AP" && inv.status === "issued") {
        apOutstanding += amt;
      }
    }
    const topClients = Object.entries(clientTotals)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));

    const tenantRow = (tenantRes.data ?? null) as Row | null;
    const companyName = (tenantRow?.legal_name || tenantRow?.name || "the company") as string;

    const retrievalContext = {
      employees: employeesRes.data ?? [],
      payrollByPeriod,
      openPeriod: openPeriodRes.data ?? null,
      openDisciplinary: disciplinaryRes.data ?? [],
      shiftAnomalies: shiftsRes.data ?? [],
      sites: sitesRes.data ?? [],
      leaveTotals,
      financials: {
        revenue, expenses, profit: revenue - expenses, cash,
        arOutstanding, arOverdue, apOutstanding, draftAr, topClients, monthly,
      },
    };
    const dataSources = [
      "employees",
      "payroll_runs",
      "pay_periods",
      "disciplinary_actions",
      "shift_logs",
      "sites",
      "ledger_lines",
      "invoices",
      "leave_balances",
    ];
    const rowsExamined =
      retrievalContext.employees.length +
      (payrollRunsRes.data?.length ?? 0) +
      retrievalContext.openDisciplinary.length +
      retrievalContext.shiftAnomalies.length +
      retrievalContext.sites.length +
      (ledgerRes.data?.length ?? 0) +
      (invoicesRes.data?.length ?? 0);

    const today = new Date().toISOString().split("T")[0];
    let contextBlock = buildContextBlock(retrievalContext, memoriesRes.data ?? [], today);
    if (retrievalErrors.length > 0) {
      contextBlock +=
        "\n\n[DATA RETRIEVAL WARNINGS — some sources failed; do NOT treat affected sections as zero/empty]\n" +
        retrievalErrors.map((e) => `  - ${e}`).join("\n");
    }

    // History was fetched newest-first (to keep the LAST 16 messages); restore chronological order.
    const history = (historyRes.data ?? []).slice().reverse();
    // deno-lint-ignore no-explicit-any
    const geminiContents: any[] = [];

    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        // Strip embedded tool JSON from history so the model isn't confused by it.
        const cleanContent = msg.content.includes(TOOL_MARKER)
          ? msg.content.split(TOOL_MARKER)[0].trim() + "\n[Document generated and delivered to user.]"
          : msg.content;
        geminiContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: cleanContent }],
        });
      }
    }

    geminiContents.push({
      role: "user",
      parts: [{ text: `${contextBlock}\n\n---\n\n${userMessage}` }],
    });

    // The model may call query_employee_detail one or more times before it has enough
    // information to answer — each round executes a whitelisted, tenant-scoped lookup and
    // feeds the result back so it can ask again or produce a final answer/document tool call.
    const MAX_QUERY_ROUNDS = 4;
    const tokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, tool_use_prompt_tokens: 0 };
    let extraRowsExamined = 0;
    const extraDataSources = new Set<string>();
    let textPart = "";
    // deno-lint-ignore no-explicit-any
    let functionPart: any = null;

    for (let round = 0; round < MAX_QUERY_ROUNDS; round++) {
      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiApiKey}`,
        {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: buildSystemPrompt(companyName) }],
          },
          contents: geminiContents,
          tools: [{ function_declarations: GEMINI_TOOLS }],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.2,
          },
        }),
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        console.error(`[erp-brain] Gemini ${geminiResp.status}: ${errText}`);
        await writeAuditEvent(adminClient, {
          tenantId,
          userId,
          sessionId,
          messageId: null,
          eventType: "error",
          promptHash: await sha256hex(userMessage),
          modelProvider: MODEL_PROVIDER,
          modelName: MODEL,
          dataSources,
          rowsExamined,
          readOnly: true,
          requestMetadata: { error: errText.slice(0, 500) },
        });
        return jsonResponse({ error: "The AI service is temporarily unavailable. Please try again shortly." }, 502);
      }

      const geminiJson = await geminiResp.json();
      tokenUsage.input_tokens += geminiJson?.usageMetadata?.promptTokenCount ?? 0;
      tokenUsage.output_tokens += geminiJson?.usageMetadata?.candidatesTokenCount ?? 0;
      tokenUsage.total_tokens += geminiJson?.usageMetadata?.totalTokenCount ?? 0;
      tokenUsage.tool_use_prompt_tokens += geminiJson?.usageMetadata?.toolUsePromptTokenCount ?? 0;

      // deno-lint-ignore no-explicit-any
      const parts: any[] = geminiJson?.candidates?.[0]?.content?.parts ?? [];
      textPart = parts
        .map((part) => typeof part.text === "string" ? part.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();
      functionPart = parts.find((part) => part.functionCall)?.functionCall ?? null;

      if (functionPart?.name === QUERY_TOOL_NAME) {
        const result = await runEmployeeDetailQuery(adminClient, tenantId, functionPart.args ?? {});
        extraRowsExamined += result.rowsExamined;
        extraDataSources.add("employees");
        geminiContents.push({ role: "model", parts: [{ functionCall: functionPart }] });
        geminiContents.push({
          role: "function",
          parts: [{ functionResponse: { name: QUERY_TOOL_NAME, response: { result: result.text } } }],
        });
        functionPart = null;
        // Out of rounds: stop calling Gemini rather than leaking an unhandled tool call to the client.
        if (round === MAX_QUERY_ROUNDS - 1) {
          textPart = textPart || "I looked up the requested details but ran out of lookup rounds to compose a full answer — please ask again more specifically.";
          break;
        }
        continue;
      }
      break;
    }

    const finalDataSources = Array.from(new Set([...dataSources, ...extraDataSources]));
    const finalRowsExamined = rowsExamined + extraRowsExamined;

    let answer: string;
    // deno-lint-ignore no-explicit-any
    let toolCall: { name: string; input: unknown } | null = null;

    if (functionPart) {
      toolCall = { name: functionPart.name, input: functionPart.args ?? {} };
      answer = `${textPart || "I've prepared your document."}\n${TOOL_MARKER}${JSON.stringify(toolCall)}`;
    } else {
      answer = textPart || "I couldn't generate a response from the available data.";
    }

    const promptHash = await sha256hex(userMessage);
    const responseHash = await sha256hex(answer);

    const { data: userMsg } = await adminClient
      .from("ai_conversation_messages")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        actor_user_id: userId,
        role: "user",
        content: userMessage,
        data_sources: finalDataSources,
        retrieval_snapshot: { rows_examined: finalRowsExamined, date: today },
        token_usage: {},
      })
      .select("id")
      .single();

    const { data: assistantMsg } = await adminClient
      .from("ai_conversation_messages")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        actor_user_id: null,
        role: "assistant",
        content: answer,
        data_sources: finalDataSources,
        retrieval_snapshot: { rows_examined: finalRowsExamined, date: today },
        token_usage: tokenUsage,
      })
      .select("id")
      .single();

    await adminClient
      .from("ai_conversation_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", sessionId);

    await Promise.all([
      writeAuditEvent(adminClient, {
        tenantId,
        userId,
        sessionId,
        messageId: userMsg?.id ?? null,
        eventType: "assistant_request",
        promptHash,
        promptPreview: userMessage.slice(0, 200),
        modelProvider: MODEL_PROVIDER,
        modelName: MODEL,
        dataSources: finalDataSources,
        rowsExamined: finalRowsExamined,
        readOnly: true,
        requestMetadata: { source: "erp_brain_v3" },
      }),
      writeAuditEvent(adminClient, {
        tenantId,
        userId,
        sessionId,
        messageId: assistantMsg?.id ?? null,
        eventType: "assistant_response",
        promptHash,
        responseHash,
        modelProvider: MODEL_PROVIDER,
        modelName: MODEL,
        dataSources: finalDataSources,
        rowsExamined: finalRowsExamined,
        readOnly: true,
        requestMetadata: { token_usage: tokenUsage, tool_used: toolCall?.name ?? null },
      }),
    ]);

    return jsonResponse({
      session_id: sessionId,
      message_id: assistantMsg?.id ?? null,
      answer,
      tool_call: toolCall,
      data_sources: finalDataSources,
      token_usage: tokenUsage,
      retrieval_errors: retrievalErrors,
    });
  } catch (error) {
    console.error("[erp-brain] Unexpected error", error);
    return jsonResponse(
      {
        error: "Unexpected error",
      },
      500,
    );
  }
});

async function writeAuditEvent(
  // deno-lint-ignore no-explicit-any
  client: any,
  opts: {
    tenantId: string;
    userId: string;
    sessionId: string;
    messageId: string | null;
    eventType: string;
    promptHash: string;
    promptPreview?: string;
    responseHash?: string;
    modelProvider: string;
    modelName: string;
    dataSources: string[];
    rowsExamined: number;
    readOnly: boolean;
    requestMetadata: Record<string, unknown>;
  },
) {
  await client.from("ai_audit_events").insert({
    tenant_id: opts.tenantId,
    user_id: opts.userId,
    session_id: opts.sessionId,
    message_id: opts.messageId,
    event_type: opts.eventType,
    prompt_hash: opts.promptHash,
    prompt_preview: opts.promptPreview ?? null,
    response_hash: opts.responseHash ?? null,
    model_provider: opts.modelProvider,
    model_name: opts.modelName,
    data_sources: opts.dataSources,
    retrieval_plan: {},
    rows_examined: opts.rowsExamined,
    token_usage: opts.requestMetadata.token_usage ?? {},
    read_only: opts.readOnly,
    request_metadata: opts.requestMetadata,
  });
}
