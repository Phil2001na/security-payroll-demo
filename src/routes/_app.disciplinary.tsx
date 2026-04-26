import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_app/disciplinary")({
  component: () => (
    <ComingSoon
      icon={ShieldAlert}
      title="Disciplinary actions"
      description="Offences, unpaid suspensions, and Section 12(5)-compliant fines with collective agreement references."
    />
  ),
});
