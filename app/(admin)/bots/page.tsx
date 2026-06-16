import { BotsPageClient } from "@/components/bots-page-client";
import { getRecallPreflight, getRecallWebhookUrl } from "@/lib/recall";

export default function BotsPage() {
  const preflight = getRecallPreflight();

  return (
    <BotsPageClient
      webhookUrl={getRecallWebhookUrl()}
      preflightErrors={preflight.errors}
      preflightWarnings={preflight.warnings}
    />
  );
}
