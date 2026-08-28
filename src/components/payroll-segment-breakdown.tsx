// Makes the internal segment calculation visible on the payroll detail, not just auditable
// in the stored run (UAT 2026-08-20 decision #2 — "must be visible/auditable on the payslip
// or payroll detail, not a hidden total").
//
// Shows the Sunday basis that was applied and every segment of a shift that crossed a rule
// boundary, naming the ONE stored shift each set of segments came from so nobody reads the
// split as two rostered shifts.
import { Layers } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SUNDAY_BOUNDARY_MODE_LABELS } from "@/lib/shift-segments";
import type { PayslipCalc } from "@/lib/payroll-engine";

const BASIS_LABEL: Record<string, string> = {
  contract_agreed_1_5x: "Agreed contract rate",
  statutory_default_2x: "Statutory default",
};

export function PayrollSegmentBreakdown({ calc }: { calc: PayslipCalc }) {
  const breakdown = calc.breakdown;
  const crossing = breakdown.segments.filter((s) => s.crosses_midnight);
  const hasPremium =
    calc.sunday_hours > 0 || calc.sunday_callin_hours > 0 || calc.public_holiday_hours > 0;
  if (!hasPremium && crossing.length === 0) return null;

  // One entry per stored shift, so the panel reads as "this shift, paid in these parts".
  const byShift = new Map<string, typeof crossing>();
  for (const segment of crossing) {
    const existing = byShift.get(segment.shift_log_id);
    if (existing) existing.push(segment);
    else byShift.set(segment.shift_log_id, [segment]);
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground underline decoration-dotted"
        >
          <Layers className="h-3 w-3" />
          How this was calculated
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-[26rem] text-xs space-y-2">
        <div>
          <div className="font-semibold text-sm">Sunday basis</div>
          <div className="text-muted-foreground">
            {BASIS_LABEL[breakdown.sunday_basis] ?? breakdown.sunday_basis} —{" "}
            {breakdown.sunday_multiplier_applied}× on rostered Sunday hours,{" "}
            {breakdown.sunday_callin_multiplier_applied}× on call-in relief.
          </div>
          {!breakdown.sunday_consent_verified && breakdown.sunday_consent_reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {breakdown.sunday_consent_reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {breakdown.sunday_base_rate_source === "manual_period_entry" && (
            <div className="mt-1 text-muted-foreground">
              Sunday hours based on the manually entered period rate of N$
              {breakdown.sunday_base_rate.toFixed(2)}.
            </div>
          )}
        </div>

        {byShift.size > 0 && (
          <div>
            <div className="font-semibold text-sm">
              {byShift.size} shift{byShift.size === 1 ? "" : "s"} crossed midnight
            </div>
            <div className="text-muted-foreground">
              {SUNDAY_BOUNDARY_MODE_LABELS[breakdown.boundary_mode]}. Each shift below is one stored
              roster record, paid in the parts shown.
            </div>
            <div className="mt-1 space-y-1.5 max-h-56 overflow-y-auto">
              {[...byShift.values()].slice(0, 12).map((segments) => (
                <div key={segments[0].shift_log_id}>
                  <div className="font-mono">
                    {segments[0].shift_starts_at.replace("T", " ")} →{" "}
                    {segments[0].shift_ends_at.replace("T", " ")} ({segments[0].shift_hours}h)
                  </div>
                  <ul className="pl-3 text-muted-foreground">
                    {segments.map((segment) => (
                      <li key={`${segment.shift_log_id}-${segment.segment_index}`}>
                        {segment.segment_date} {segment.segment_start}–{segment.segment_end} ·{" "}
                        {segment.hours.toFixed(2).replace(/\.00$/, "")}h · {segment.applied_rule}
                        {segment.rule_reason ? ` (${segment.rule_reason})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {byShift.size > 12 && (
                <div className="text-muted-foreground">
                  …and {byShift.size - 12} more. The full breakdown is stored with the payroll run.
                </div>
              )}
            </div>
          </div>
        )}

        {!breakdown.segment_integrity.balanced && (
          <div className="text-destructive">
            Segment total ({breakdown.segment_integrity.segment_minutes} min) does not match the
            stored shift total ({breakdown.segment_integrity.stored_minutes} min) — do not finalize;
            report this.
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
