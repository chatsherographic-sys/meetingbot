import { unstable_noStore as noStore } from "next/cache";
import { SettingsPageClient } from "@/components/settings-page-client";
import { getRecallWebhookUrl } from "@/lib/recall";
import { getAppSettings } from "@/lib/store";
import type { StorageLoggingMode } from "@/lib/types";

export default async function SettingsPage() {
  noStore();

  const recallRegion = process.env.RECALL_REGION?.trim() || "(not set)";
  const sendChatEnabled =
    process.env.RECALL_SEND_CHAT_ENABLED?.trim().toLowerCase() === "true";
  const publicWebhookBaseUrl =
    process.env.PUBLIC_WEBHOOK_BASE_URL?.trim() || "http://localhost:3000";
  const recallApiKeyConfigured = Boolean(process.env.RECALL_API_KEY?.trim());
  let storageLoggingMode: StorageLoggingMode = "production_minimal";

  try {
    const appSettings = await getAppSettings();
    storageLoggingMode = appSettings.storageLoggingMode;
  } catch {
    storageLoggingMode = "production_minimal";
  }

  return (
    <SettingsPageClient
      fullWebhookUrl={getRecallWebhookUrl()}
      publicWebhookBaseUrl={publicWebhookBaseUrl}
      recallApiKeyConfigured={recallApiKeyConfigured}
      recallRegion={recallRegion}
      sendChatEnabled={sendChatEnabled}
      storageLoggingMode={storageLoggingMode}
    />
  );
}
