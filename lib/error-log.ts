import { recordErrorLog } from "@/lib/store";

export async function recordErrorLogSafely(input: {
  source: string;
  error: unknown;
  sessionId?: string | null;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : "Unknown server error.";
  try {
    await recordErrorLog({ source: input.source, message, sessionId: input.sessionId });
  } catch {
    // Never hide the original API failure if the error log storage is unavailable.
  }
}
