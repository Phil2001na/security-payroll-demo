import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are the executive intelligence assistant for Dog Force Security's ERP system.

Your role: Help the CEO understand the current state of the business through clear, concise analysis of live payroll and operations data.

STRICT CONSTRAINTS:
- READ-ONLY. You cannot and must not suggest modifying any data.
- FACTUAL. Only use data provided in this conversation. Never fabricate or estimate figures.
- HONEST. If you lack data to answer a question, say so explicitly.

RESPONSE STYLE:
- Lead with the direct answer.
- Keep responses executive-focused and concise (2–4 paragraphs max unless a detailed breakdown is explicitly requested).
- Format financial figures as NAD X,XXX.XX.
- Use plain prose. Bold for key figures is acceptable.
- Flag anomalies and risks when the data reveals them.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTenantId(claims: Record<string, unknown> | null, appMeta: Record<string, unknown>): string | null {
  const candidates = [
    claims?.tenant_id,
    claims?.org_id,
    (claims?.app_metadata as Record<string, unknown> | undefined)?.tenant_id,
    appMeta?.tenant_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
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
      ? data.openDisciplinary.map((d) => `  - ${d.category} / ${d.severity} on ${d.incident_date}`)
      : []),
    "",
  ];

  if (data.openPeriod) {
    lines.push(`Current open pay period: ${data.openPeriod.label} (${data.openPeriod.start_date} – ${data.openPeriod.end_date})`);
  } else {
    lines.push("No open pay period.");
  }

  if (data.payrollRuns.length > 0) {
    lines.push("", "Recent payroll runs:");
    for (const r of data.payrollRuns) {
      const when = r.finalized_at ? r.finalized_at.split("T")[0] : "pending";
      lines.push(`  - ${r.status} on ${when}: gross NAD ${Number(r.gross_total ?? 0).toLocaleString("en-NA", { minimumFractionDigits: 2 })}, net NAD ${Number(r.net_total ?? 0).toLocaleString("en-NA", { minimumFractionDigits: 2 })}`);
    }
  }

  if (data.shiftAnomalies.length > 0) {
    lines.push("", `Shift anomalies (last 14 days, non-approved): ${data.shiftAnomalies.length} records`);
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

  if (memories.length > 0) {
    lines.push("", "[CEO PREFERENCES & FOCUS AREAS]");
    for (const m of memories) {
      lines.push(`  [${m.memory_type}] ${m.label}: ${m.content}`);
    }
  }

  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey || !anthropicApiKey) {
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
    const claims = parseJwtClaims(jwt);
    const tenantId = extractTenantId(claims, userData.user.app_metadata ?? {});
    if (!tenantId) {
      return jsonResponse({ error: "No tenant_id found in token." }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // CEO gate — must have explicit is_ceo_executive flag
    const { data: profile } = await adminClient
      .from("profiles")
      .select("is_ceo_executive, is_active")
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!profile?.is_ceo_executive || !profile?.is_active) {
      return jsonResponse({ error: "Access denied. Executive assistant is CEO-only." }, 403);
    }

    const body = await req.json().catch(() => null) as { message?: string; session_id?: string } | null;
    const userMessage = body?.message?.trim();
    if (!userMessage) {
      return jsonResponse({ error: "message is required." }, 400);
    }

    // --- Session management ---
    let sessionId = body?.session_id ?? null;
    if (!sessionId) {
      const { data: newSession, error: sessionErr } = await adminClient
        .from("ai_conversation_sessions")
        .insert({
          tenant_id: tenantId,
          owner_user_id: userId,
          title: userMessage.slice(0, 80),
          model_provider: "anthropic",
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

    // --- Load history and memories in parallel ---
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

    // --- Targeted retrieval (no full-table dumps) ---
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const [employeesRes, payrollRunsRes, openPeriodRes, disciplinaryRes, shiftsRes, sitesRes] = await Promise.all([
      adminClient
        .from("employees")
        .select("id, status, position")
        .eq("tenant_id", tenantId)
        .eq("status", "active"),
      adminClient
        .from("payroll_runs")
        .select("id, status, gross_total, net_total, deductions_total, finalized_at")
        .eq("tenant_id", tenantId)
        .order("finalized_at", { ascending: false })
        .limit(3),
      adminClient
        .from("pay_periods")
        .select("id, label, status, start_date, end_date")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .maybeSingle(),
      adminClient
        .from("disciplinary_actions")
        .select("id, employee_id, incident_date, category, severity")
        .eq("tenant_id", tenantId)
        .is("resolved_at", null)
        .order("incident_date", { ascending: false })
        .limit(20),
      adminClient
        .from("shift_logs")
        .select("id, employee_id, site_id, date, status, hours_worked")
        .eq("tenant_id", tenantId)
        .gte("date", fourteenDaysAgo)
        .in("status", ["absent", "late", "rejected", "pending"])
        .order("date", { ascending: false })
        .limit(30),
      adminClient
        .from("sites")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
    ]);

    const retrievalContext = {
      employees: employeesRes.data ?? [],
      payrollRuns: payrollRunsRes.data ?? [],
      openPeriod: openPeriodRes.data ?? null,
      openDisciplinary: disciplinaryRes.data ?? [],
      shiftAnomalies: shiftsRes.data ?? [],
      sites: sitesRes.data ?? [],
    };
    const dataSources = ["employees", "payroll_runs", "pay_periods", "disciplinary_actions", "shift_logs", "sites"];
    const rowsExamined =
      retrievalContext.employees.length + retrievalContext.payrollRuns.length +
      retrievalContext.openDisciplinary.length + retrievalContext.shiftAnomalies.length +
      retrievalContext.sites.length;

    const today = new Date().toISOString().split("T")[0];
    const contextBlock = buildContextBlock(retrievalContext, memoriesRes.data ?? [], today);

    // --- Build Anthropic messages ---
    const history = historyRes.data ?? [];
    const anthropicMessages: Array<{ role: string; content: string }> = [];

    // Replay stored history (raw Q&A without context prefixes)
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Current turn: context + user question
    anthropicMessages.push({
      role: "user",
      content: `${contextBlock}\n\n---\n\n${userMessage}`,
    });

    // --- Call Claude with prompt caching on the stable system block ---
    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: anthropicMessages,
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      await writeAuditEvent(adminClient, {
        tenantId, userId, sessionId, messageId: null,
        eventType: "error", promptHash: await sha256hex(userMessage),
        modelProvider: "anthropic", modelName: MODEL,
        dataSources, rowsExamined, readOnly: true,
        requestMetadata: { error: errText.slice(0, 500) },
      });
      return jsonResponse({ error: "Claude request failed.", details: errText }, 502);
    }

    const anthropicJson = await anthropicResp.json();
    const answer: string = anthropicJson?.content?.[0]?.text ?? "";
    const tokenUsage = {
      input_tokens: anthropicJson?.usage?.input_tokens ?? 0,
      output_tokens: anthropicJson?.usage?.output_tokens ?? 0,
      cache_read_input_tokens: anthropicJson?.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: anthropicJson?.usage?.cache_creation_input_tokens ?? 0,
    };

    // --- Save messages ---
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

    // --- Write audit events ---
    await Promise.all([
      writeAuditEvent(adminClient, {
        tenantId, userId, sessionId,
        messageId: userMsg?.id ?? null,
        eventType: "assistant_request",
        promptHash,
        promptPreview: userMessage.slice(0, 200),
        modelProvider: "anthropic", modelName: MODEL,
        dataSources, rowsExamined, readOnly: true,
        requestMetadata: { source: "erp_brain_v2" },
      }),
      writeAuditEvent(adminClient, {
        tenantId, userId, sessionId,
        messageId: assistantMsg?.id ?? null,
        eventType: "assistant_response",
        promptHash,
        responseHash,
        modelProvider: "anthropic", modelName: MODEL,
        dataSources, rowsExamined, readOnly: true,
        requestMetadata: { token_usage: tokenUsage },
      }),
    ]);

    return jsonResponse({
      session_id: sessionId,
      message_id: assistantMsg?.id ?? null,
      answer,
      data_sources: dataSources,
      token_usage: tokenUsage,
    });
  } catch (error) {
    return jsonResponse(
      { error: "Unexpected error", details: error instanceof Error ? error.message : String(error) },
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
