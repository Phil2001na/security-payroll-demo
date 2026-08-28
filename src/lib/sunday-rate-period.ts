// Period-scoped Sunday base rate: reading the stored row, shaping it for validation, and
// turning a payroll run into the ordinary rates the entry is checked against
// (UAT 2026-08-20 decisions #5 and #6).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { round2 } from "@/lib/payroll-engine";
import {
  compareSundayBaseRate,
  validateSundayBaseRate,
  type OrdinaryRateSample,
  type SundayRateAcknowledgement,
  type SundayRateValidation,
} from "@/lib/sunday-rate";
import type { Tables } from "@/integrations/supabase/types";

export type SundayRateRow = Tables<"payroll_sunday_rates">;

export function useSundayBaseRate(periodId: string | undefined) {
  return useQuery({
    queryKey: ["payroll_sunday_rate", periodId],
    enabled: !!periodId,
    queryFn: async (): Promise<SundayRateRow | null> => {
      const { data, error } = await supabase
        .from("payroll_sunday_rates")
        .select("*")
        .eq("pay_period_id", periodId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function acknowledgementOf(row: SundayRateRow | null): SundayRateAcknowledgement | null {
  if (!row) return null;
  return {
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedRate: row.acknowledged_rate == null ? null : Number(row.acknowledged_rate),
    acknowledgedOrdinaryRate:
      row.acknowledged_ordinary_rate == null ? null : Number(row.acknowledged_ordinary_rate),
    reason: row.acknowledgement_reason,
  };
}

// The ordinary rate the period was calculated on. Drawn from the run itself rather than from
// the employees table so the comparison is against what payroll actually computed.
export function ordinaryRateSamples(
  calcs: Array<{ employee: { id: string; surname: string; first_names: string }; rate: number }>,
): OrdinaryRateSample[] {
  return calcs.map((c) => ({
    employeeId: c.employee.id,
    employeeName: `${c.employee.surname}, ${c.employee.first_names}`,
    ordinaryRate: c.rate,
  }));
}

// Exported so the payroll screen builds the validation once and shares it with the finalize
// guard, rather than the card and the button disagreeing about the same numbers.
export function buildSundayRateValidation(
  row: SundayRateRow | null,
  ordinaryRates: OrdinaryRateSample[],
): SundayRateValidation | null {
  if (!row) return null;
  if (ordinaryRates.length === 0) {
    // No run on screen to compare against, so use the ordinary rate recorded when the rate
    // was entered — which is exactly what the finalize gate in the database checks.
    const comparison = compareSundayBaseRate({
      enteredRate: Number(row.sunday_base_rate),
      calculatedOrdinaryRate: Number(row.calculated_ordinary_rate),
    });
    return {
      ...comparison,
      distinctOrdinaryRates: [round2(Number(row.calculated_ordinary_rate))],
      mismatches: [],
      matchedEmployeeCount: 0,
    };
  }
  return validateSundayBaseRate({
    enteredRate: Number(row.sunday_base_rate),
    ordinaryRates,
  });
}
