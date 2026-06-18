import {
  DEFAULT_SESSION_ID,
  emptyStore,
  normalizeStoreData,
  storeCorruptionRecoveryError,
} from "../lib/store";
import { createLocalStoreAdapter } from "../lib/storage/local-store";
import { createSupabaseStoreAdapter } from "../lib/storage/supabase-store";

async function main() {
  const localAdapter = createLocalStoreAdapter({
    emptyStore,
    normalizeStoreData,
    corruptionRecoveryError: storeCorruptionRecoveryError,
  });
  const supabaseAdapter = createSupabaseStoreAdapter({
    emptyStore,
    normalizeStoreData,
    corruptionRecoveryError: storeCorruptionRecoveryError,
  });

  const store = await localAdapter.readStore();

  if (!store.meetingSessions.some((session) => session.id === DEFAULT_SESSION_ID)) {
    store.meetingSessions.unshift(emptyStore.meetingSessions[0]);
  }

  await supabaseAdapter.initialize();
  await supabaseAdapter.writeStore(store);

  console.log("Export to Supabase completed.");
  console.log(`storageLoggingMode: ${store.storageLoggingMode}`);
  console.log(`meetingSessions: ${store.meetingSessions.length}`);
  console.log(`recallBots: ${store.recallBots.length}`);
  console.log(`scheduledBotJoins: ${store.scheduledBotJoins.length}`);
  console.log(`triggerRules: ${store.triggerRules.length}`);
  console.log(`timerTriggers: ${store.timerTriggers.length}`);
  console.log(`matchLogs: ${store.matchLogs.length}`);
  console.log(`timerTriggerLogs: ${store.timerTriggerLogs.length}`);
  console.log(`liveChatTemplates: ${store.liveChatTemplates.length}`);
  console.log(`liveChatLogs: ${store.liveChatLogs.length}`);
  console.log(`webhookDebugLogs: ${store.webhookDebugLogs.length}`);
  console.log(`transcriptLogs: ${store.transcriptLogs.length}`);
}

void main().catch((error) => {
  console.error("Export to Supabase failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
