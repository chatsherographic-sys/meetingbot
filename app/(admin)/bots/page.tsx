import { BotsPageClient } from "@/components/bots-page-client";
import { getRecallPreflight } from "@/lib/recall";

export default function BotsPage() {
  const preflight = getRecallPreflight();

  return (
    <BotsPageClient
      preflightErrors={preflight.errors}
      preflightWarnings={preflight.warnings}
    />
  );
}
