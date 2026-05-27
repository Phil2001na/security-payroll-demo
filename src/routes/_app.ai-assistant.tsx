import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Send, Plus, ShieldCheck, Loader2, MessageSquare, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/ai-assistant")({
  component: AiAssistantPage,
  head: () => ({ meta: [{ title: "Executive Assistant — Dog Force Payroll" }] }),
});

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

function AccessDenied() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Card>
        <CardContent className="p-12 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-lg mb-1">Executive access required</p>
          <p className="text-sm text-muted-foreground mb-4">
            The AI Assistant is available exclusively to designated executives.
          </p>
          <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
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
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <Button size="sm" className="w-full" onClick={onNew}>
          <Plus className="mr-2 h-4 w-4" /> New conversation
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && sessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8 px-3">
              No conversations yet. Start by asking a question.
            </p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                activeId === s.id
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-muted text-foreground/80",
              )}
            >
              <div className="flex items-start gap-2">
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-60" />
                <span className="line-clamp-2 leading-snug">
                  {s.title ?? "New conversation"}
                </span>
              </div>
              <p className="text-[10px] opacity-50 mt-1 ml-5">
                {s.last_message_at
                  ? new Date(s.last_message_at).toLocaleDateString()
                  : new Date(s.created_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {message.content.split("\n").map((line, i) => (
          <p key={i} className={i > 0 ? "mt-2" : ""}>
            {line || <>&nbsp;</>}
          </p>
        ))}
        <p className={cn("text-[10px] mt-1 opacity-50", isUser ? "text-right" : "text-left")}>
          {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function ChatArea({
  sessionId,
  onSessionCreated,
}: {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Optimistic user message while waiting for response
  const optimisticMessages: Message[] = sendMutation.isPending
    ? [
        ...messages,
        {
          id: "optimistic-user",
          role: "user",
          content: input || (sendMutation.variables ?? ""),
          created_at: new Date().toISOString(),
        } as Message,
      ]
    : messages;

  if (!sessionId && !sendMutation.isPending) {
    return (
      <div className="flex-1 flex flex-col min-h-0 items-center justify-center gap-4 p-8">
        <BrainCircuit className="h-12 w-12 text-muted-foreground/50" />
        <div className="text-center">
          <p className="font-semibold text-lg">Executive Intelligence Assistant</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Ask about payroll, attendance, disciplinary actions, site operations, or business performance.
          </p>
        </div>
        <div className="w-full max-w-xl">
          <ChatInput
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            sending={sendMutation.isPending}
            ref={textareaRef}
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-center max-w-xl">
          {STARTER_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => { setInput(q); textareaRef.current?.focus(); }}
              className="text-xs border rounded-full px-3 py-1.5 hover:bg-muted transition-colors text-muted-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {loadingMessages && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {optimisticMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          {sendMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <div className="border-t p-4">
        <div className="max-w-2xl mx-auto">
          <ChatInput
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            sending={sendMutation.isPending}
            ref={textareaRef}
          />
        </div>
      </div>
    </div>
  );
}

const ChatInput = ({
  value,
  onChange,
  onKeyDown,
  onSend,
  sending,
  ref,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  sending: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
}) => (
  <div className="flex items-end gap-2">
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Ask about payroll, attendance, sites… (Enter to send, Shift+Enter for new line)"
      rows={2}
      className="resize-none text-sm"
      disabled={sending}
    />
    <Button size="icon" onClick={onSend} disabled={sending || !value.trim()}>
      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    </Button>
  </div>
);

const STARTER_QUESTIONS = [
  "How many employees are active right now?",
  "What's the status of our latest payroll run?",
  "Are there any open disciplinary actions?",
  "Any shift anomalies this week?",
];

function AiAssistantPage() {
  const { profile } = useAuth();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<Session[]>({
    queryKey: ["ai-sessions"],
    enabled: !!profile?.is_ceo_executive,
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

  if (!profile?.is_ceo_executive) return <AccessDenied />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r flex flex-col bg-background transition-all duration-200",
          showSidebar ? "w-64 shrink-0" : "w-0 overflow-hidden",
        )}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <BrainCircuit className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">Executive Assistant</span>
        </div>
        <SessionList
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={(id) => setActiveSessionId(id)}
          onNew={() => setActiveSessionId(null)}
          loading={loadingSessions}
        />
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setShowSidebar((v) => !v)}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", !showSidebar && "rotate-180")} />
          </Button>
          <span className="text-sm text-muted-foreground">
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
