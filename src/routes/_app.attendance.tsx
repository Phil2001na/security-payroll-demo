import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_app/attendance")({
  component: () => (
    <ComingSoon
      icon={ClipboardList}
      title="Attendance"
      description="Daily clock-in/out, missed-shift flagging, and supervisor approval queue."
    />
  ),
});
