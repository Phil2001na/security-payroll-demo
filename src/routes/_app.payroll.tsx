import { createFileRoute } from "@tanstack/react-router";
import { Calculator } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_app/payroll")({
  component: () => (
    <ComingSoon
      icon={Calculator}
      title="Payroll"
      description="Pay-period management, gross-to-net calc, statutory deductions (PAYE / SSC / VET), payslips, and the ABSA bank export."
    />
  ),
});
