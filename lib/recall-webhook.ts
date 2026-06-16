const chineseNumeralMap: Record<string, string> = {
  零: "0",
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

export const transcriptProcessingEvents = new Set([
  "transcript.data",
  "transcript.partial_data",
]);

export const ignoredWebhookEvents = new Set([
  "transcript.failed",
  "transcript.done",
]);

type RecallWebhookPayload = {
  event?: unknown;
  data?: {
    bot?: {
      id?: unknown;
    };
    recording?: {
      bot?: {
        id?: unknown;
      };
    };
    data?: {
      words?: Array<{
        text?: unknown;
      }>;
      transcript?: unknown;
      text?: unknown;
    };
    transcript?: unknown;
    text?: unknown;
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinWords(words: unknown): string | null {
  if (!Array.isArray(words)) {
    return null;
  }

  const joined = words
    .map((word) => (asObject(word)?.text as string | undefined)?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();

  return joined || null;
}

export function getWebhookEventName(payload: unknown): string {
  const event = asObject(payload)?.event;
  return typeof event === "string" && event.trim() ? event.trim() : "unknown";
}

export function extractWebhookBotId(payload: unknown): string | null {
  const data = asObject(asObject(payload)?.data);
  const directBotId = readString(asObject(data?.bot)?.id);

  if (directBotId) {
    return directBotId;
  }

  return readString(asObject(asObject(data?.recording)?.bot)?.id);
}

export function extractTranscriptTextFromWebhook(payload: unknown): string | null {
  const data = asObject(asObject(payload)?.data);
  const nestedData = asObject(data?.data);

  return (
    joinWords(nestedData?.words) ??
    readString(nestedData?.transcript) ??
    readString(nestedData?.text) ??
    readString(data?.transcript) ??
    readString(data?.text) ??
    null
  );
}

export function normalizeChineseNumerals(input: string): string {
  return input.replace(/[零一二三四五六七八九]/g, (character) =>
    chineseNumeralMap[character] ?? character,
  );
}

export function isTranscriptProcessingEvent(
  eventName: string,
): eventName is "transcript.data" | "transcript.partial_data" {
  return transcriptProcessingEvents.has(eventName);
}
