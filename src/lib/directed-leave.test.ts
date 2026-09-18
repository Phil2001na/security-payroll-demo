import { describe, expect, it } from "vitest";
import {
  DIRECTED_LEAVE_RESPONSES,
  RESPONSE_HINT,
  RESPONSE_LABEL,
  directedLeaveBlockedReason,
  directedLeaveCsvRows,
  directedLeaveWarnings,
  isDirectedLeaveResponse,
  responseBadgeClass,
  type DirectedLeaveDraft,
  type DirectedLeaveRow,
} from "./directed-leave";

const draft = (over: Partial<DirectedLeaveDraft> = {}): DirectedLeaveDraft => ({
  employeeId: "e1",
  leaveStart: "2027-04-05",
  leaveEnd: "2027-04-16",
  reason: "Guard is 30 days from their statutory deadline.",
  response: "acknowledged",
  typedAcknowledgement: "Johannes Amakali",
  responseNote: "",
  witnessName: "",
  ...over,
});

describe("what blocks a directed-leave record from being saved", () => {
  it("accepts a complete draft", () => {
    expect(directedLeaveBlockedReason(draft())).toBeNull();
  });

  it("requires an employee", () => {
    expect(directedLeaveBlockedReason(draft({ employeeId: "" }))).toContain("employee");
  });

  it("requires both dates", () => {
    expect(directedLeaveBlockedReason(draft({ leaveStart: "" }))).toContain("dates");
    expect(directedLeaveBlockedReason(draft({ leaveEnd: "" }))).toContain("dates");
  });

  it("rejects an end date before the start", () => {
    expect(
      directedLeaveBlockedReason(draft({ leaveStart: "2027-04-16", leaveEnd: "2027-04-05" })),
    ).toContain("cannot be before");
  });

  it("allows a single-day offer", () => {
    expect(
      directedLeaveBlockedReason(draft({ leaveStart: "2027-04-05", leaveEnd: "2027-04-05" })),
    ).toBeNull();
  });

  it("requires a reason", () => {
    expect(directedLeaveBlockedReason(draft({ reason: "   " }))).toContain("reason");
  });

  it("requires a response", () => {
    expect(directedLeaveBlockedReason(draft({ response: "" }))).toContain("what the employee said");
  });

  it("requires a typed name only when the employee acknowledged", () => {
    expect(
      directedLeaveBlockedReason(draft({ response: "acknowledged", typedAcknowledgement: "  " })),
    ).toContain("Type the employee's name");

    // The whole point of refused_to_sign is that there is no name to type.
    expect(
      directedLeaveBlockedReason(draft({ response: "refused_to_sign", typedAcknowledgement: "" })),
    ).toBeNull();
    expect(
      directedLeaveBlockedReason(draft({ response: "refused", typedAcknowledgement: "" })),
    ).toBeNull();
  });
});

describe("warnings that do not block", () => {
  it("says nothing for a clean acknowledgement", () => {
    expect(directedLeaveWarnings(draft(), 0)).toEqual([]);
  });

  it("flags a refusal to sign with no witness", () => {
    const w = directedLeaveWarnings(draft({ response: "refused_to_sign", responseNote: "x" }), 0);
    expect(w.join(" ")).toContain("witness");
  });

  it("does not flag a witnessed refusal to sign", () => {
    const w = directedLeaveWarnings(
      draft({ response: "refused_to_sign", witnessName: "S. Nangolo", responseNote: "x" }),
      0,
    );
    expect(w).toEqual([]);
  });

  it("flags a refusal with neither note nor attachment", () => {
    const w = directedLeaveWarnings(draft({ response: "refused" }), 0);
    expect(w.join(" ")).toContain("No note and no attachment");
  });

  it("is satisfied by an attachment instead of a note", () => {
    const w = directedLeaveWarnings(draft({ response: "refused" }), 1);
    expect(w.join(" ")).not.toContain("No note and no attachment");
  });

  it("never blocks — an unrecordable event becomes an unrecorded one", () => {
    // A bare refusal is weak evidence but must still be saveable.
    const bare = draft({ response: "refused", responseNote: "", witnessName: "" });
    expect(directedLeaveWarnings(bare, 0).length).toBeGreaterThan(0);
    expect(directedLeaveBlockedReason(bare)).toBeNull();
  });
});

describe("the response vocabulary", () => {
  it("matches the database CHECK constraint exactly", () => {
    expect([...DIRECTED_LEAVE_RESPONSES]).toEqual(["acknowledged", "refused", "refused_to_sign"]);
  });

  it("labels and explains every response", () => {
    for (const r of DIRECTED_LEAVE_RESPONSES) {
      expect(RESPONSE_LABEL[r]).toBeTruthy();
      expect(RESPONSE_HINT[r].length).toBeGreaterThan(20);
      expect(responseBadgeClass(r)).toContain("border");
    }
  });

  it("recognises only the three valid values", () => {
    expect(isDirectedLeaveResponse("refused_to_sign")).toBe(true);
    expect(isDirectedLeaveResponse("signed")).toBe(false);
  });
});

describe("the export", () => {
  const row: DirectedLeaveRow = {
    id: "d1",
    offered_on: "2027-03-01",
    leave_start: "2027-04-05",
    leave_end: "2027-04-16",
    reason: "Approaching statutory deadline",
    response: "refused_to_sign",
    typed_acknowledgement: null,
    response_note: "Declined, would not sign",
    witness_name: "S. Nangolo",
    attachments: ["t/e/scan.pdf"],
    recorded_at: "2027-03-01T09:00:00Z",
    employees: { surname: "Amakali", first_names: "Johannes", employee_code: "AS-014" },
  };

  it("flattens a record into one spreadsheet row", () => {
    const [csv] = directedLeaveCsvRows([row]);
    expect(csv["Employee code"]).toBe("AS-014");
    expect(csv.Employee).toBe("Amakali, Johannes");
    expect(csv.Response).toBe("Refused to sign");
    expect(csv.Witness).toBe("S. Nangolo");
    expect(csv.Attachments).toBe("1");
  });

  it("exports blanks rather than null or undefined", () => {
    const [csv] = directedLeaveCsvRows([
      { ...row, typed_acknowledgement: null, response_note: null, witness_name: null },
    ]);
    // A literal "null" in a spreadsheet cell reads as data; a blank reads as absent.
    for (const v of Object.values(csv)) expect(v).not.toContain("null");
    expect(csv.Witness).toBe("");
  });

  it("survives an employee row that failed to join", () => {
    const [csv] = directedLeaveCsvRows([{ ...row, employees: null }]);
    expect(csv.Employee).toBe("");
    expect(csv["Employee code"]).toBe("");
  });

  it("counts attachments rather than dumping storage paths into the sheet", () => {
    const [csv] = directedLeaveCsvRows([{ ...row, attachments: ["a", "b", "c"] }]);
    expect(csv.Attachments).toBe("3");
  });

  it("exports every record given to it", () => {
    expect(directedLeaveCsvRows([row, { ...row, id: "d2" }])).toHaveLength(2);
    expect(directedLeaveCsvRows([])).toEqual([]);
  });
});
