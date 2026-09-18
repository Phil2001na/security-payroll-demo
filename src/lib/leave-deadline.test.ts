import { describe, expect, it } from "vitest";
import {
  LEAVE_DEADLINE_WINDOW_DAYS,
  daysBetween,
  deadlineRisk,
  describeDeadlineRisk,
  hasCapacityDeadlineConflict,
  rejectionNeedsDeadlineWarning,
} from "./leave-deadline";
import type { CapacityWarning } from "./leave-capacity";

const TODAY = "2026-09-17";

describe("statutory leave deadline risk", () => {
  it("counts whole days between two ISO dates", () => {
    expect(daysBetween("2026-09-17", "2026-09-20")).toBe(3);
    expect(daysBetween("2026-09-20", "2026-09-17")).toBe(-3);
    expect(daysBetween("2026-09-17", "2026-09-17")).toBe(0);
  });

  it("counts across a month and a year boundary", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("reports unknown, not none, when there is no cycle on record", () => {
    // The distinction matters: "none" would tell the approver it has been checked and is fine.
    const r = deadlineRisk({ latestLeaveDate: null, requestEnd: "2026-10-01", today: TODAY });
    expect(r.level).toBe("unknown");
    expect(r.daysRemaining).toBeNull();
    expect(r.clearsDeadline).toBeNull();
  });

  it("flags a deadline already passed as overdue", () => {
    const r = deadlineRisk({
      latestLeaveDate: "2026-09-10",
      requestEnd: "2026-10-01",
      today: TODAY,
    });
    expect(r.level).toBe("overdue");
    expect(r.daysRemaining).toBe(-7);
  });

  it("flags a deadline inside the planner window as approaching", () => {
    const r = deadlineRisk({
      latestLeaveDate: "2026-10-01",
      requestEnd: "2026-09-30",
      today: TODAY,
    });
    expect(r.level).toBe("approaching");
    expect(r.daysRemaining).toBe(14);
  });

  it("treats today as approaching, not overdue", () => {
    const r = deadlineRisk({ latestLeaveDate: TODAY, requestEnd: TODAY, today: TODAY });
    expect(r.level).toBe("approaching");
    expect(r.daysRemaining).toBe(0);
  });

  it("uses the same 90-day window as the leave planner", () => {
    const edge = deadlineRisk({
      latestLeaveDate: "2026-12-16", // exactly 90 days after 2026-09-17
      requestEnd: "2026-12-01",
      today: TODAY,
    });
    expect(edge.daysRemaining).toBe(LEAVE_DEADLINE_WINDOW_DAYS);
    expect(edge.level).toBe("approaching");

    const beyond = deadlineRisk({
      latestLeaveDate: "2026-12-17",
      requestEnd: "2026-12-01",
      today: TODAY,
    });
    expect(beyond.level).toBe("none");
  });

  it("says whether the request actually discharges the deadline", () => {
    const clears = deadlineRisk({
      latestLeaveDate: "2026-10-01",
      requestEnd: "2026-09-30",
      today: TODAY,
    });
    expect(clears.clearsDeadline).toBe(true);

    // Leave booked after the deadline still leaves the guard exposed.
    const misses = deadlineRisk({
      latestLeaveDate: "2026-10-01",
      requestEnd: "2026-10-05",
      today: TODAY,
    });
    expect(misses.clearsDeadline).toBe(false);

    const onTheDay = deadlineRisk({
      latestLeaveDate: "2026-10-01",
      requestEnd: "2026-10-01",
      today: TODAY,
    });
    expect(onTheDay.clearsDeadline).toBe(true);
  });

  it("describes each level in plain language", () => {
    expect(
      describeDeadlineRisk(
        deadlineRisk({ latestLeaveDate: "2026-09-10", requestEnd: null, today: TODAY }),
      ),
    ).toBe("Statutory deadline passed on 2026-09-10 — 7 days ago.");
    expect(
      describeDeadlineRisk(
        deadlineRisk({ latestLeaveDate: "2026-10-01", requestEnd: null, today: TODAY }),
      ),
    ).toBe("Annual leave must be taken by 2026-10-01 — 14 days left.");
    expect(
      describeDeadlineRisk(
        deadlineRisk({ latestLeaveDate: "2027-06-01", requestEnd: null, today: TODAY }),
      ),
    ).toBe("Annual leave must be taken by 2027-06-01. Not urgent.");
    expect(
      describeDeadlineRisk(deadlineRisk({ latestLeaveDate: null, requestEnd: null, today: TODAY })),
    ).toContain("could not be checked");
  });
});

describe("cap versus deadline collision (D-16 — shown, never resolved)", () => {
  const capWarning: CapacityWarning[] = [{ kind: "monthly", month: "2026-09", count: 11, max: 10 }];
  const urgent = deadlineRisk({ latestLeaveDate: "2026-10-01", requestEnd: null, today: TODAY });
  const relaxed = deadlineRisk({ latestLeaveDate: "2027-06-01", requestEnd: null, today: TODAY });

  it("is a conflict only when both a warning and a live deadline are present", () => {
    expect(hasCapacityDeadlineConflict(capWarning, urgent)).toBe(true);
    expect(hasCapacityDeadlineConflict([], urgent)).toBe(false);
    expect(hasCapacityDeadlineConflict(capWarning, relaxed)).toBe(false);
  });

  it("does not treat an unknown deadline as a conflict", () => {
    const unknown = deadlineRisk({ latestLeaveDate: null, requestEnd: null, today: TODAY });
    expect(hasCapacityDeadlineConflict(capWarning, unknown)).toBe(false);
  });
});

describe("rejection warnings (never silently deny leave)", () => {
  it("warns when rejecting leave that is overdue or approaching", () => {
    expect(
      rejectionNeedsDeadlineWarning(
        deadlineRisk({ latestLeaveDate: "2026-09-10", requestEnd: null, today: TODAY }),
      ),
    ).toBe(true);
    expect(
      rejectionNeedsDeadlineWarning(
        deadlineRisk({ latestLeaveDate: "2026-10-01", requestEnd: null, today: TODAY }),
      ),
    ).toBe(true);
  });

  it("stays quiet when the deadline is far off or unknown", () => {
    expect(
      rejectionNeedsDeadlineWarning(
        deadlineRisk({ latestLeaveDate: "2027-06-01", requestEnd: null, today: TODAY }),
      ),
    ).toBe(false);
    expect(
      rejectionNeedsDeadlineWarning(
        deadlineRisk({ latestLeaveDate: null, requestEnd: null, today: TODAY }),
      ),
    ).toBe(false);
  });
});
