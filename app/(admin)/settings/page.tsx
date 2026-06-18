import { unstable_noStore as noStore } from "next/cache";
import { SettingsPageClient } from "@/components/settings-page-client";
import { getStorageHealth } from "@/lib/store";

export default async function SettingsPage() {
  noStore();

  const recallRegion = process.env.RECALL_REGION?.trim() || "(not set)";
  const sendChatEnabled =
    process.env.RECALL_SEND_CHAT_ENABLED?.trim().toLowerCase() === "true";
  const recallApiKeyConfigured = Boolean(process.env.RECALL_API_KEY?.trim());
  const storageHealth = await getStorageHealth();

  return (
    <SettingsPageClient
      recallApiKeyConfigured={recallApiKeyConfigured}
      recallRegion={recallRegion}
      sendChatEnabled={sendChatEnabled}
      storageDriver={storageHealth.storageDriver}
      storageOk={storageHealth.ok}
      storageCheckedAt={storageHealth.checkedAt}
      storageError={storageHealth.error}
    />
  );
}
