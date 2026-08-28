// Manual Sunday base rate entry, its validation warning and the acknowledgement that
// releases submission (UAT 2026-08-20 decisions #5 and #6).
//
// The card never blocks anything by itself. Entering a rate that differs from the calculated
// ordinary rate is allowed and the payroll run continues; what it produces is a warning that
// an authorised user has to take on the record before the period can be finalized. The
// database enforces both halves — `set_sunday_base_rate` and `acknowledge_sunday_rate_variance`
// are SECURITY DEFINER and check the caller's role — so this screen is the convenience, not
// the control.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNAD } from "@/lib/format";
import {
  acknowledgementCovers,
  canAcknowledgeSundayRateWarning,
  type OrdinaryRateSample,
  type SundayRateValidation,
} from "@/lib/sunday-rate";
import { acknowledgementOf, type SundayRateRow } from "@/lib/sunday-rate-period";

export function SundayBaseRateCard({
  periodId,
  isLocked,
  role,
  ordinaryRates,
  validation,
  row,
}: {
  periodId: string | undefined;
  isLocked: boolean;
  role: string | null | undefined;
  ordinaryRates: OrdinaryRateSample[];
  validation: SundayRateValidation | null;
  row: SundayRateRow | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const canEdit = canAcknowledgeSundayRateWarning(role) && !isLocked && !!periodId;

  // Follow the stored value whenever the period (or the stored rate) changes, so switching
  // periods never leaves another period's rate sitting in the box.
  useEffect(() => {
    setDraft(row?.sunday_base_rate == null ? "" : String(Number(row.sunday_base_rate)));
    setReason("");
  }, [row?.sunday_base_rate, periodId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payroll_sunday_rate", periodId] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const rate = Number(draft);
      if (!Number.isFinite(rate) || rate < 0)
        throw new Error("Enter a Sunday base rate of zero or more.");
      const { error } = await supabase.rpc("set_sunday_base_rate", {
        p_period: periodId!,
        p_rate: rate,
        // Recorded alongside the entry so the difference stays reconstructable later, even
        // if rates change afterwards.
        p_calculated_ordinary_rate: validation?.calculatedOrdinaryRate ?? 0,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sunday base rate saved");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save the Sunday base rate"),
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clear_sunday_base_rate", { p_period: periodId! });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sunday base rate cleared — Sunday hours revert to each guard's ordinary rate");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not clear the Sunday base rate"),
  });

  const acknowledgeMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("acknowledge_sunday_rate_variance", {
        p_period: periodId!,
        p_reason: reason.trim() ? reason.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Difference acknowledged and recorded in the audit trail");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not acknowledge the difference"),
  });

  const acknowledgement = acknowledgementOf(row);
  const acknowledged = !!validation && acknowledgementCovers(acknowledgement, validation);
  const showWarning = !!validation && validation.status === "variance";
  const busy = saveMut.isPending || clearMut.isPending || acknowledgeMut.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sunday base rate</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter the Sunday base rate for this period. It is checked against the ordinary rate
          calculated from the run — a difference is allowed, but an authorised payroll user has to
          acknowledge it before the period can be finalized. Leave it empty to base Sunday hours on
          each guard&apos;s own ordinary rate.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sunday-base-rate">Sunday base rate (N$/hour)</Label>
            <Input
              id="sunday-base-rate"
              className="w-40"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={draft}
              disabled={!canEdit || busy}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Not set"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Calculated ordinary rate</Label>
            <div className="h-9 flex items-center font-mono text-sm">
              {ordinaryRates.length === 0
                ? "Run payroll first"
                : formatNAD(validation?.calculatedOrdinaryRate ?? 0)}
              {validation && validation.distinctOrdinaryRates.length > 1 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({validation.distinctOrdinaryRates.length} distinct rates in this period)
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={!canEdit || busy || !draft.trim()}
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save rate
          </Button>
          {row && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => clearMut.mutate()}
              disabled={!canEdit || busy}
            >
              Clear
            </Button>
          )}
        </div>

        {!canAcknowledgeSundayRateWarning(role) && (
          <p className="text-xs text-muted-foreground">
            Only the payroll and admin roles can enter or acknowledge the Sunday base rate.
          </p>
        )}

        {showWarning && !acknowledged && (
          <div className="space-y-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <div>
                <strong>Sunday base rate differs from the calculated ordinary rate</strong>
                <p className="mt-1">{validation.message}</p>
                {validation.mismatches.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    Differs for {validation.mismatches.length} of{" "}
                    {validation.mismatches.length + validation.matchedEmployeeCount} guards
                    {validation.mismatches.length <= 5
                      ? `: ${validation.mismatches.map((m) => m.employeeName).join(", ")}`
                      : ""}
                    .
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  Payroll can continue. Finalizing the period needs this acknowledged first.
                </p>
              </div>
            </div>
            {row && (
              <div className="space-y-2">
                <Label htmlFor="sunday-rate-reason" className="text-xs">
                  Reason (optional — recorded in the audit trail)
                </Label>
                <Textarea
                  id="sunday-rate-reason"
                  rows={2}
                  value={reason}
                  disabled={!canEdit || busy}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Negotiated Sunday base rate for this period, per client instruction."
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledgeMut.mutate()}
                  disabled={!canEdit || busy}
                  title={
                    canAcknowledgeSundayRateWarning(role)
                      ? undefined
                      : "Only the payroll and admin roles can acknowledge this"
                  }
                >
                  {acknowledgeMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Acknowledge difference
                </Button>
              </div>
            )}
            {!row && (
              <p className="text-xs text-muted-foreground">
                Save the rate before acknowledging it.
              </p>
            )}
          </div>
        )}

        {showWarning && acknowledged && acknowledgement && (
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
            <CircleCheck className="h-4 w-4 text-success mt-0.5 shrink-0" />
            <div>
              <strong>Difference acknowledged</strong>
              <p className="mt-1">
                {formatNAD(acknowledgement.acknowledgedRate ?? 0)} against a calculated ordinary
                rate of {formatNAD(acknowledgement.acknowledgedOrdinaryRate ?? 0)}, acknowledged{" "}
                {acknowledgement.acknowledgedAt
                  ? new Date(acknowledgement.acknowledgedAt).toLocaleString("en-GB")
                  : ""}
                .
              </p>
              {acknowledgement.reason && (
                <p className="mt-1 text-muted-foreground">{acknowledgement.reason}</p>
              )}
            </div>
          </div>
        )}

        {validation?.status === "match" && row && (
          <p className="text-sm text-muted-foreground">{validation.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
