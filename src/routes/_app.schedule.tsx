import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_app/schedule")({
  component: () => (
    <ComingSoon
      icon={CalendarDays}
      title="Schedule"
      description="Roster builder with shift templates, recurring patterns, and conflict detection. Coming in the next slice."
    />
  ),
});
