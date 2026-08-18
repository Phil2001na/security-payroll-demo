// Client statements (tracker #14). Computed deterministically from the invoice ledger —
// never from the AI assistant. A statement is a document the client checks against their
// own books and may dispute, so every figure on it has to be reproducible from the data.
//
// There is no separate payments table in this schema: an AR invoice is settled by moving
// it to status 'paid' with a paid_at timestamp, so a payment is that event for the full
// invoice amount. Drafts never appear (not yet issued to the client) and neither do voids.

export type StatementInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string;
  total: number;
  tenant_id: string;
  status: "draft" | "issued" | "paid" | "void";
  paid_at: string | null;
};
export type StatementPayment = { invoice_id: string; received_at: string; amount: number; reference: string | null };

export type StatementLine = {
  date: string;
  kind: "invoice" | "payment";
  reference: string;
  debit: number;   // invoice raised — increases what the client owes
  credit: number;  // payment received
  balance: number; // running balance after this line
};

export type Aging = { current: number; d30: number; d60: number; d90: number };

export type Statement = {
  start: string;
  end: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  aging: Aging;
  agingTotal: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (ts: string) => ts.slice(0, 10);

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

// Every balance-affecting event, as (date, debit, credit). Both an invoice and its
// payment come off the same row, on different dates.
function eventsOf(invoices: StatementInvoice[], payments: StatementPayment[]) {
  const out: Array<{ date: string; kind: "invoice" | "payment"; reference: string; debit: number; credit: number }> = [];
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "void") continue;
    const ref = inv.invoice_number ?? inv.id.slice(0, 8);
    out.push({ date: inv.invoice_date, kind: "invoice", reference: ref, debit: Number(inv.total) || 0, credit: 0 });
  }
  const refs = new Map(invoices.map((i) => [i.id, i.invoice_number ?? i.id.slice(0, 8)]));
  for (const payment of payments) out.push({ date: dayOf(payment.received_at), kind: "payment", reference: payment.reference || refs.get(payment.invoice_id) || payment.invoice_id.slice(0, 8), debit: 0, credit: Number(payment.amount) || 0 });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "invoice" ? -1 : 1));
}

export function buildStatement(args: {
  invoices: StatementInvoice[];
  payments?: StatementPayment[];
  start: string;
  end: string;
}): Statement {
  const { invoices, start, end, payments = [] } = args;
  const events = eventsOf(invoices, payments);

  let balance = 0;
  for (const e of events) {
    if (e.date >= start) break;
    balance += e.debit - e.credit;
  }
  const openingBalance = round2(balance);

  const lines: StatementLine[] = [];
  for (const e of events) {
    if (e.date < start || e.date > end) continue;
    balance += e.debit - e.credit;
    lines.push({ date: e.date, kind: e.kind, reference: e.reference, debit: e.debit, credit: e.credit, balance: round2(balance) });
  }
  const closingBalance = round2(balance);

  // Aging is of what is still outstanding at the closing date, bucketed by how long past
  // due each invoice is — that is the reason a statement gets sent at all.
  const aging: Aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "void") continue;
    if (inv.invoice_date > end) continue;
    const paid = payments.filter((p) => p.invoice_id === inv.id && dayOf(p.received_at) <= end).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const outstanding = Math.max(0, Number(inv.total) - paid);
    if (outstanding === 0) continue;
    const overdue = daysBetween(inv.due_date, end);
    const amt = outstanding;
    if (overdue <= 0) aging.current += amt;
    else if (overdue <= 30) aging.d30 += amt;
    else if (overdue <= 60) aging.d60 += amt;
    else aging.d90 += amt;
  }
  aging.current = round2(aging.current);
  aging.d30 = round2(aging.d30);
  aging.d60 = round2(aging.d60);
  aging.d90 = round2(aging.d90);
  const agingTotal = round2(aging.current + aging.d30 + aging.d60 + aging.d90);

  return { start, end, openingBalance, lines, closingBalance, aging, agingTotal };
}
