import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const MODEL_PROVIDER = "gemini";

function buildSystemPrompt(companyName: string): string {
  return `You are the executive intelligence assistant for ${companyName}'s ERP system — a security workforce, payroll and accounting platform.

Your role: Help the executive understand the current state of the business through clear, concise analysis of live payroll, operations, and financial data. You see headcount, scheduling/attendance anomalies, disciplinary matters, the full general ledger (revenue, expenses, cash, receivables, payables), and invoicing.

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
You have three document tools. Use them when the user explicitly asks for a report, chart, spreadsheet, or download.
- generate_pdf_report: Formatted PDF report with sections and tables.
- generate_excel: Excel spreadsheet with one or more sheets.
- generate_chart: Inline chart rendered in the conversation.

When calling a tool, ALWAYS include a short text message first explaining what you are generating.`;
}

const TOOLS = [
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

function buildContextBlock(
  data: {
    employees: Row[];
    payrollRuns: Row[];
    openPeriod: Row | null;
    openDisciplinary: Row[];
    shiftAnomalies: Row[];
    sites: Row[];
    financials: {
      revenue: number; expenses: number; profit: number; cash: number;
      arOutstanding: number; arOverdue: number; apOutstanding: number;
      draftAr: number; topClients: Array<{ name: string; amount: number }>;
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
          (d) => `  - ${d.action_type} (${d.offence_code}) on ${d.incident_date}`,
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

  if (data.payrollRuns.length > 0) {
    lines.push("", "Recent payroll runs:");
    for (const r of data.payrollRuns) {
      const when = r.finalized_at ? r.finalized_at.split("T")[0] : "pending";
      lines.push(
        `  - ${r.status} on ${when}: gross NAD ${Number(r.gross_salary ?? 0).toLocaleString("en-NA", { minimumFractionDigits: 2 })}, net NAD ${Number(r.net_salary ?? 0).toLocaleString("en-NA", { minimumFractionDigits: 2 })}`,
      );
    }
  }

  if (data.shiftAnomalies.length > 0) {
    lines.push(
      "",
      `Shift anomalies (last 14 days, non-approved): ${data.shiftAnomalies.length} records`,
    );
    const bySite: Record<string, number> = {};
    for (const s of data.shiftAnomalies) {
      bySite[s.site_id ?? "unknown"] = (bySite[s.site_id ?? "unknown"] ?? 0) + 1;
    }
    for (const [site, n] of Object.entries(bySite)) {
      lines.push(`  Site ${site}: ${n} anomalies`);
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
  }

  if (memories.length > 0) {
    lines.push("", "[CEO PREFERENCES & FOCUS AREAS]");
    for (const m of memories) {
      lines.push(`  [${m.memory_type}] ${m.label}: ${m.content}`);
    }
  }

  return lines.join("\n");
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
      .select("is_ceo_executive, is_active, tenant_id")
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.is_ceo_executive || !profile?.is_active) {
      return jsonResponse({ error: "Access denied. Executive assistant is CEO-only." }, 403);
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
        .order("created_at", { ascending: true })
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
      employeesRes, payrollRunsRes, openPeriodRes, disciplinaryRes, shiftsRes, sitesRes,
      tenantRes, ledgerRes, invoicesRes,
    ] = await Promise.all([
        adminClient
          .from("employees")
          .select("id, status, position")
          .eq("tenant_id", tenantId)
          .eq("status", "active"),
        adminClient
          .from("payroll_runs")
          .select("id, status, gross_salary, net_salary, total_deductions, finalized_at")
          .eq("tenant_id", tenantId)
          .order("finalized_at", { ascending: false, nullsFirst: false })
          .limit(5),
        adminClient
          .from("pay_periods")
          .select("id, label, status, start_date, end_date")
          .eq("tenant_id", tenantId)
          .eq("status", "open")
          .maybeSingle(),
        adminClient
          .from("disciplinary_actions")
          .select("id, employee_id, incident_date, action_type, offence_code")
          .eq("tenant_id", tenantId)
          .order("incident_date", { ascending: false })
          .limit(20),
        adminClient
          .from("shift_logs")
          .select("id, employee_id, site_id, date, status, hours_worked")
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
          .select("debit, credit, chart_of_accounts!inner(code, type)")
          .eq("tenant_id", tenantId),
        adminClient
          .from("invoices")
          .select("type, status, total, due_date, clients:client_id(name), vendors:vendor_id(name)")
          .eq("tenant_id", tenantId)
          .neq("status", "void"),
      ]);

    const retrievalErrors: string[] = [];
    const checkRes = (label: string, err: { message: string } | null) => {
      if (err) {
        console.error(`erp-brain retrieval error [${label}]:`, err.message);
        retrievalErrors.push(`${label}: ${err.message}`);
      }
    };
    checkRes("employees", employeesRes.error);
    checkRes("payroll_runs", payrollRunsRes.error);
    checkRes("pay_periods", openPeriodRes.error);
    checkRes("disciplinary_actions", disciplinaryRes.error);
    checkRes("shift_logs", shiftsRes.error);
    checkRes("sites", sitesRes.error);
    checkRes("ledger_lines", ledgerRes.error);
    checkRes("invoices", invoicesRes.error);

    // ----- derive financial position from the ledger + invoices -----
    let revenue = 0, expenses = 0, cash = 0;
    for (const l of (ledgerRes.data ?? []) as Row[]) {
      const acc = Array.isArray(l.chart_of_accounts) ? l.chart_of_accounts[0] : l.chart_of_accounts;
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      if (acc?.type === "income") revenue += c - d;
      else if (acc?.type === "expense") expenses += d - c;
      if (acc?.code === "1001") cash += d - c;
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
      payrollRuns: payrollRunsRes.data ?? [],
      openPeriod: openPeriodRes.data ?? null,
      openDisciplinary: disciplinaryRes.data ?? [],
      shiftAnomalies: shiftsRes.data ?? [],
      sites: sitesRes.data ?? [],
      financials: {
        revenue, expenses, profit: revenue - expenses, cash,
        arOutstanding, arOverdue, apOutstanding, draftAr, topClients,
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
    ];
    const rowsExamined =
      retrievalContext.employees.length +
      retrievalContext.payrollRuns.length +
      retrievalContext.openDisciplinary.length +
      retrievalContext.shiftAnomalies.length +
      retrievalContext.sites.length;

    const today = new Date().toISOString().split("T")[0];
    let contextBlock = buildContextBlock(retrievalContext, memoriesRes.data ?? [], today);
    if (retrievalErrors.length > 0) {
      contextBlock +=
        "\n\n[DATA RETRIEVAL WARNINGS — some sources failed; do NOT treat affected sections as zero/empty]\n" +
        retrievalErrors.map((e) => `  - ${e}`).join("\n");
    }

    const history = historyRes.data ?? [];
    const geminiContents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

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
      return jsonResponse({ error: "Gemini request failed.", details: errText }, 502);
    }

    const geminiJson = await geminiResp.json();
    const tokenUsage = {
      input_tokens: geminiJson?.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: geminiJson?.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: geminiJson?.usageMetadata?.totalTokenCount ?? 0,
      tool_use_prompt_tokens: geminiJson?.usageMetadata?.toolUsePromptTokenCount ?? 0,
    };

    let answer: string;
    // deno-lint-ignore no-explicit-any
    let toolCall: { name: string; input: unknown } | null = null;
    const parts: any[] = geminiJson?.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts
      .map((part) => typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    const functionPart = parts.find((part) => part.functionCall)?.functionCall;

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
        data_sources: dataSources,
        retrieval_snapshot: { rows_examined: rowsExamined, date: today },
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
        data_sources: dataSources,
        retrieval_snapshot: { rows_examined: rowsExamined, date: today },
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
        dataSources,
        rowsExamined,
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
        dataSources,
        rowsExamined,
        readOnly: true,
        requestMetadata: { token_usage: tokenUsage, tool_used: toolCall?.name ?? null },
      }),
    ]);

    return jsonResponse({
      session_id: sessionId,
      message_id: assistantMsg?.id ?? null,
      answer,
      tool_call: toolCall,
      data_sources: dataSources,
      token_usage: tokenUsage,
      retrieval_errors: retrievalErrors,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Unexpected error",
        details: error instanceof Error ? error.message : String(error),
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
