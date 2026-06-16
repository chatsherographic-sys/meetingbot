import { ScheduledBotsPageClient } from "@/components/scheduled-bots-page-client";
import { getRecallPreflight } from "@/lib/recall";

export default function ScheduledBotsPage() {
  const preflight = getRecallPreflight();

  return (
    <ScheduledBotsPageClient
      preflightErrors={preflight.errors}
      preflightWarnings={preflight.warnings}
    />
  );
}
