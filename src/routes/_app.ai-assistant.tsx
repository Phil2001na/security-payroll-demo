import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Send,
  Plus,
  ShieldCheck,
  Loader2,
  FileText,
  Sheet,
  BarChart2,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/ai-assistant")({
  component: AiAssistantPage,
  head: () => ({ meta: [{ title: "AI Assistant — Demo Payroll System" }] }),
});

// ─── Types ───────────────────────────────────────────────────────────────────

type Session = {
  id: string;
  title: string | null;
  status: string;
  last_message_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
};

type PdfSection = {
  heading: string;
  body?: string;
  table?: { columns: string[]; rows: string[][] };
};

type PdfInput = {
  title: string;
  subtitle?: string;
  summary?: string;
  sections: PdfSection[];
};

type ExcelSheet = { name: string; columns: string[]; rows: string[][] };
type ExcelInput = { filename: string; sheets: ExcelSheet[] };

type ChartInput = {
  type: "bar" | "line" | "pie" | "area";
  title: string;
  data: Record<string, unknown>[];
  x_key: string;
  y_keys: string[];
  colors?: string[];
};

type ToolCall =
  | { name: "generate_pdf_report"; input: PdfInput }
  | { name: "generate_excel"; input: ExcelInput }
  | { name: "generate_chart"; input: ChartInput };

// ─── Document generators ─────────────────────────────────────────────────────

function generatePdf(input: PdfInput) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // Header bar
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text("DEMO PAYROLL SYSTEM — CONFIDENTIAL", 14, 11.5);

  // Title
  doc.setTextColor(15, 15, 15);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(input.title, 14, 34);

  let y = 40;

  if (input.subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(input.subtitle, 14, y);
    y += 7;
  }

  doc.setDrawColor(220, 220, 220);
  doc.line(14, y, pageW - 14, y);
  y += 7;

  if (input.summary) {
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(input.summary, pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 5 + 6;
  }

  for (const section of input.sections) {
    if (y > 260) { doc.addPage(); y = 20; }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 15, 15);
    doc.text(section.heading, 14, y);
    y += 6;

    if (section.body) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(70, 70, 70);
      const lines = doc.splitTextToSize(section.body, pageW - 28);
      doc.text(lines, 14, y);
      y += lines.length * 4.8 + 4;
    }

    if (section.table) {
      autoTable(doc, {
        head: [section.table.columns],
        body: section.table.rows,
        startY: y,
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [15, 15, 15], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 248, 248] },
      });
      // @ts-expect-error jspdf-autotable extends the doc object
      y = doc.lastAutoTable.finalY + 10;
    } else {
      y += 4;
    }
  }

  // Footer
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 160);
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-NA", { dateStyle: "long" })} · Demo Payroll System`,
    14,
    doc.internal.pageSize.getHeight() - 10,
  );

  doc.save(`${input.title.replace(/\s+/g, "-")}.pdf`);
}

function generateExcel(input: ExcelInput) {
  const wb = XLSX.utils.book_new();
  for (const sheet of input.sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
    // Bold the header row
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  XLSX.writeFile(wb, `${input.filename}.xlsx`);
}

// ─── Inline chart ─────────────────────────────────────────────────────────────

const CHART_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

function AiChart({ type, title, data, x_key, y_keys, colors }: ChartInput) {
  const palette = colors?.length ? colors : CHART_COLORS;
  const commonProps = { data, margin: { top: 4, right: 12, left: 0, bottom: 4 } };

  return (
    <div className="mt-3 rounded-xl border bg-background p-4">
      <p className="text-xs font-semibold text-foreground/70 mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        {type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey={y_keys[0]} nameKey={x_key} cx="50%" cy="50%" outerRadius={85} label>
              {data.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : type === "line" ? (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x_key} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={48} />
            <Tooltip />
            {y_keys.map((k, i) => (
              <Line key={k} dataKey={k} stroke={palette[i % palette.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === "area" ? (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x_key} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={48} />
            <Tooltip />
            {y_keys.map((k, i) => (
              <Area
                key={k}
                dataKey={k}
                stroke={palette[i % palette.length]}
                fill={palette[i % palette.length]}
                fillOpacity={0.12}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x_key} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={48} />
            <Tooltip />
            {y_keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={palette[i % palette.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ─── Markdown renderer ───────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="font-mono text-[0.82em] bg-black/8 rounded px-1 py-px">
          {part.slice(1, -1)}
        </code>
      );
    return <span key={i}>{part}</span>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const headingMatch = block.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
          const lvl = headingMatch[1].length;
          return (
            <p key={i} className={cn("font-semibold", lvl === 1 ? "text-[15px]" : "text-[13px]")}>
              {renderInline(headingMatch[2])}
            </p>
          );
        }

        const bulletLines = block.split("\n").filter((l) => /^[-*]\s/.test(l));
        if (bulletLines.length > 0) {
          return (
            <ul key={i} className="space-y-1">
              {bulletLines.map((line, j) => (
                <li key={j} className="flex gap-2 items-start">
                  <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-40" />
                  <span>{renderInline(line.replace(/^[-*]\s/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        const numberedLines = block.split("\n").filter((l) => /^\d+\.\s/.test(l));
        if (numberedLines.length > 0) {
          return (
            <ol key={i} className="space-y-1">
              {numberedLines.map((line, j) => (
                <li key={j} className="flex gap-2 items-start">
                  <span className="shrink-0 text-[10px] font-mono opacity-40 mt-px w-4">{j + 1}.</span>
                  <span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={i} className="leading-relaxed">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

// ─── Tool card ────────────────────────────────────────────────────────────────

function ToolCard({ toolCall }: { toolCall: ToolCall }) {
  const isPdf = toolCall.name === "generate_pdf_report";
  const isExcel = toolCall.name === "generate_excel";
  const isChart = toolCall.name === "generate_chart";

  if (isChart) {
    return <AiChart {...(toolCall.input as ChartInput)} />;
  }

  const icon = isPdf ? (
    <FileText className="h-4 w-4 text-red-500" />
  ) : (
    <Sheet className="h-4 w-4 text-green-600" />
  );

  const label = isPdf
    ? (toolCall.input as PdfInput).title
    : `${(toolCall.input as ExcelInput).filename}.xlsx`;

  const ext = isPdf ? "PDF" : "Excel";

  const handleDownload = () => {
    try {
      if (isPdf) generatePdf(toolCall.input as PdfInput);
      else generateExcel(toolCall.input as ExcelInput);
    } catch {
      toast.error("Failed to generate document.");
    }
  };

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border bg-background px-4 py-3 max-w-xs">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium truncate">{label}</p>
        <p className="text-[11px] text-muted-foreground">{ext} document ready</p>
      </div>
      <button
        onClick={handleDownload}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Parse message content (extract embedded tool call) ───────────────────────

const TOOL_MARKER = "<<<TOOL>>>";

function parseContent(content: string): { text: string; toolCall: ToolCall | null } {
  const idx = content.indexOf(TOOL_MARKER);
  if (idx === -1) return { text: content, toolCall: null };

  const text = content.slice(0, idx).trim();
  const raw = content.slice(idx + TOOL_MARKER.length).trim();
  try {
    return { text, toolCall: JSON.parse(raw) as ToolCall };
  } catch {
    return { text: content, toolCall: null };
  }
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const { text, toolCall } = parseContent(message.content);

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[72%]">
          <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground">
            {text}
          </div>
          <p className="mt-1 text-right text-[10px] text-muted-foreground/60">{time}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <BrainCircuit className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1 max-w-[84%]">
        <div className="text-[13.5px] text-foreground">
          {text && <Markdown text={text} />}
        </div>
        {toolCall && <ToolCard toolCall={toolCall} />}
        <p className="mt-1.5 text-[10px] text-muted-foreground/60">{time}</p>
      </div>
    </div>
  );
}

// ─── Chat input ───────────────────────────────────────────────────────────────

const ChatInput = ({
  value,
  onChange,
  onSend,
  sending,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-2xl border bg-background px-3 py-2.5 shadow-sm focus-within:ring-1 focus-within:ring-primary/30 transition-shadow">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your business…"
        rows={1}
        disabled={sending}
        className="flex-1 resize-none bg-transparent text-[13.5px] placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed"
        style={{ maxHeight: 120, overflowY: "auto" }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        }}
      />
      <button
        onClick={onSend}
        disabled={sending || !value.trim()}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
          value.trim() && !sending
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-muted text-muted-foreground cursor-not-allowed",
        )}
      >
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
};

// ─── Session list ─────────────────────────────────────────────────────────────

function groupByDate(sessions: Session[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const groups: { label: string; items: Session[] }[] = [];
  const map = new Map<string, Session[]>();

  for (const s of sessions) {
    const d = new Date(s.last_message_at ?? s.created_at).toDateString();
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }

  for (const [label, items] of map) {
    groups.push({ label, items });
  }

  return groups;
}

function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  loading,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  loading: boolean;
}) {
  const groups = groupByDate(sessions);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <p className="text-[11.5px] text-muted-foreground text-center py-8 px-3 leading-relaxed">
            Start a conversation to see your history here.
          </p>
        )}
        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="px-2 mb-1 text-[10.5px] font-medium text-muted-foreground/60 uppercase tracking-wide">
              {label}
            </p>
            <div className="space-y-0.5">
              {items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "w-full text-left rounded-xl px-3 py-2 text-[12.5px] transition-colors",
                    activeId === s.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground/75 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="line-clamp-1 leading-snug">
                    {s.title ?? "New conversation"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Starter prompts ──────────────────────────────────────────────────────────

const STARTERS = [
  "How is the business doing this month?",
  "Chart revenue vs expenses by month",
  "Give me a payroll summary as a PDF",
  "Who has open disciplinary actions?",
  "Any shift anomalies this week?",
];

// ─── Chat area ────────────────────────────────────────────────────────────────

function ChatArea({
  sessionId,
  onSessionCreated,
}: {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const { data: messages = [], isLoading: loadingMessages } = useQuery<Message[]>({
    queryKey: ["ai-messages", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_conversation_messages")
        .select("id, role, content, created_at")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await supabase.functions.invoke("erp-brain", {
        body: { message: text, session_id: sessionId },
      });
      if (error) throw error;
      return data as { session_id: string; answer: string };
    },
    onSuccess: (data) => {
      if (!sessionId) onSessionCreated(data.session_id);
      void qc.invalidateQueries({ queryKey: ["ai-messages", data.session_id] });
      void qc.invalidateQueries({ queryKey: ["ai-sessions"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to send message.");
    },
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate(text);
  };

  const visibleMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  const optimistic: Message[] = sendMutation.isPending
    ? [
        ...visibleMessages,
        {
          id: "opt-user",
          role: "user",
          content: sendMutation.variables ?? "",
          created_at: new Date().toISOString(),
        } as Message,
      ]
    : visibleMessages;

  if (!sessionId && !sendMutation.isPending) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-12">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <BrainCircuit className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-[16px] font-semibold tracking-tight">Executive Assistant</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
              Ask about payroll, operations, attendance, or request a report.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center max-w-lg">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
                className="rounded-full border bg-background px-3.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t p-4">
          <div className="max-w-2xl mx-auto">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              sending={sendMutation.isPending}
              inputRef={inputRef}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {loadingMessages && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {optimistic.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {sendMutation.isPending && (
            <div className="flex gap-3">
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <BrainCircuit className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            sending={sendMutation.isPending}
            inputRef={inputRef}
          />
          <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground/50">
            Read-only · Data refreshed each message
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Access denied ────────────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="font-semibold">Executive access required</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The AI Assistant is available to designated executives only.
        </p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function AiAssistantPage() {
  const { profile } = useAuth();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const canUseAi = profile?.is_ceo_executive === true || profile?.role === "admin";

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<Session[]>({
    queryKey: ["ai-sessions"],
    enabled: canUseAi,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_conversation_sessions")
        .select("id, title, status, last_message_at, created_at")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Session[];
    },
  });

  if (!canUseAi) return <AccessDenied />;

  return (
    <div className="flex h-[calc(100vh-var(--header-height,0px))] overflow-hidden bg-muted/20">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r bg-background flex flex-col transition-all duration-200 shrink-0",
          sidebarOpen ? "w-60" : "w-0 overflow-hidden",
        )}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <BarChart2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-[13px] font-semibold truncate">Conversations</span>
        </div>
        <SessionList
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={setActiveSessionId}
          onNew={() => setActiveSessionId(null)}
          loading={loadingSessions}
        />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center gap-2 px-3 h-12 border-b bg-background shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>
          <span className="text-[13px] text-muted-foreground truncate">
            {activeSessionId
              ? (sessions.find((s) => s.id === activeSessionId)?.title ?? "Conversation")
              : "New conversation"}
          </span>
        </header>

        <ChatArea
          sessionId={activeSessionId}
          onSessionCreated={(id) => setActiveSessionId(id)}
        />
      </div>
    </div>
  );
}
