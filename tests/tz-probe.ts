// Prints the segmentation of a fixed midnight-crossing shift as JSON.
//
// The timezone test runs this under several TZ values and compares the output byte for
// byte. The app stores wall-clock dates, never instants, so the answer must not move when
// the host clock does — running it out-of-process is the only way to prove that, since the
// runtime reads TZ once at start-up.
import { segmentShift } from "../src/lib/shift-segments.ts";

const result = segmentShift({
  // Saturday 18:00 → Sunday 06:00, the shift the client used in the UAT.
  anchorDate: "2026-08-22",
  startMin: 18 * 60,
  durationMinutes: 12 * 60,
  boundaryMode: "midnight_split",
});

process.stdout.write(
  JSON.stringify({
    startsAt: result.startsAt,
    endsAt: result.endsAt,
    endDate: result.endDate,
    crossesMidnight: result.crossesMidnight,
    totals: result.totals,
    segments: result.segments.map((s) => ({
      date: s.date,
      dayOfWeek: s.dayOfWeek,
      window: `${s.startClock}-${s.endClock}`,
      minutes: s.minutes,
      nightMinutes: s.nightMinutes,
      calendarRule: s.calendarRule,
      appliedRule: s.appliedRule,
    })),
  }),
);
