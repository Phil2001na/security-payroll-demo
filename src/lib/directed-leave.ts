// UAT-13 — directed-leave evidence: what the employer offered, and what the employee said.
//
// Decision §7 of DECISIONS-2026-09-03.md: typed acknowledgement plus attachments, no
// signature-capture UI. A drawn on-screen signature's evidentiary weight in a Namibian labour
// dispute is itself unreviewed, so an attached scan of a signed paper form is the stronger
// artifact and the cheaper build.

export const DIRECTED_LEAVE_RESPONSES = ["acknowledged", "refused", "refused_to_sign"] as const;
export type DirectedLeaveResponse = (typeof DIRECTED_LEAVE_RESPONSES)[number];

export const RESPONSE_LABEL: Record<DirectedLeaveResponse, string> = {
  acknowledged: "Acknowledged the offer",
  refused: "Refused the leave",
  refused_to_sign: "Refused to sign",
};

export const RESPONSE_HINT: Record<DirectedLeaveResponse, string> = {
  acknowledged: "The employee accepted the dates. Type their name exactly as they gave it.",
  refused: "The employee declined the dates offered. Record what they said in the note.",
  refused_to_sign:
    "The employee would not put their name to it. A witness makes this far stronger evidence.",
};

export function responseBadgeClass(response: DirectedLeaveResponse): string {
  switch (response) {
    case "acknowledged":
      return "bg-success/15 text-success border-success/30";
    case "refused":
      return "bg-warning/15 text-warning border-warning/40";
    default:
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

export type DirectedLeaveDraft = {
  employeeId: string;
  leaveStart: string;
  leaveEnd: string;
  reason: string;
  response: DirectedLeaveResponse | "";
  typedAcknowledgement: string;
  responseNote: string;
  witnessName: string;
};

/**
 * Returns why the draft cannot be saved yet, or null when it is ready. Mirrors the checks in
 * record_directed_leave so the form never submits something the database will reject.
 */
export function directedLeaveBlockedReason(draft: DirectedLeaveDraft): string | null {
  if (!draft.employeeId) return "Choose the employee this was offered to.";
  if (!draft.leaveStart || !draft.leaveEnd) return "Give the dates that were offered.";
  if (draft.leaveEnd < draft.leaveStart) return "The last day cannot be before the first.";
  if (!draft.reason.trim()) return "Give the reason the leave was offered or instructed.";
  if (!draft.response) return "Record what the employee said.";
  if (draft.response === "acknowledged" && !draft.typedAcknowledgement.trim()) {
    return "Type the employee's name to record their acknowledgement.";
  }
  return null;
}

/**
 * Warnings that do not block saving. A refusal with nothing else recorded is legally weak,
 * but an employer who genuinely has nothing more must still be able to record the refusal —
 * an unrecordable event becomes an unrecorded one.
 */
export function directedLeaveWarnings(
  draft: DirectedLeaveDraft,
  attachmentCount: number,
): string[] {
  const out: string[] = [];
  if (draft.response === "refused_to_sign" && !draft.witnessName.trim()) {
    out.push("No witness recorded. A refusal to sign is much weaker evidence without one.");
  }
  if (
    (draft.response === "refused" || draft.response === "refused_to_sign") &&
    !draft.responseNote.trim() &&
    attachmentCount === 0
  ) {
    out.push("No note and no attachment. Consider recording what the employee actually said.");
  }
  return out;
}

export function isDirectedLeaveResponse(value: string): value is DirectedLeaveResponse {
  return (DIRECTED_LEAVE_RESPONSES as readonly string[]).includes(value);
}

export type DirectedLeaveRow = {
  id: string;
  offered_on: string;
  leave_start: string;
  leave_end: string;
  reason: string;
  response: DirectedLeaveResponse;
  typed_acknowledgement: string | null;
  response_note: string | null;
  witness_name: string | null;
  attachments: string[];
  recorded_at: string;
  employees: { surname: string; first_names: string; employee_code: string } | null;
};

/** The export §7 asks for. One row per record, no nesting, so it opens in any spreadsheet. */
export function directedLeaveCsvRows(rows: DirectedLeaveRow[]): Record<string, string>[] {
  return rows.map((r) => ({
    "Employee code": r.employees?.employee_code ?? "",
    Employee: r.employees ? `${r.employees.surname}, ${r.employees.first_names}` : "",
    "Offered on": r.offered_on,
    "Leave from": r.leave_start,
    "Leave to": r.leave_end,
    Reason: r.reason,
    Response: RESPONSE_LABEL[r.response] ?? r.response,
    "Typed acknowledgement": r.typed_acknowledgement ?? "",
    Note: r.response_note ?? "",
    Witness: r.witness_name ?? "",
    Attachments: String(r.attachments?.length ?? 0),
    "Recorded at": r.recorded_at,
  }));
}
