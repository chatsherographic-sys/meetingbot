function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinWordTexts(words: unknown): string | null {
  if (!Array.isArray(words)) {
    return null;
  }

  const text = words
    .map((word) => readString(asObject(word)?.text) ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();

  return text || null;
}

function extractTranscriptTextFromItem(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) {
    return item.trim();
  }

  const object = asObject(item);

  if (!object) {
    return null;
  }

  return (
    readString(object.text) ??
    readString(object.transcript) ??
    readString(object.sentence) ??
    readString(object.content) ??
    joinWordTexts(object.words) ??
    null
  );
}

function extractTranscriptItems(rawResponse: unknown): unknown[] {
  if (Array.isArray(rawResponse)) {
    return rawResponse;
  }

  const object = asObject(rawResponse);

  if (!object) {
    return [];
  }

  const candidateCollections = [
    object.items,
    object.results,
    object.data,
    object.transcript,
  ];

  for (const candidate of candidateCollections) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function deriveBotStatus(rawResponse: Record<string, unknown>): string {
  if (typeof rawResponse.status === "string" && rawResponse.status.trim()) {
    return rawResponse.status.trim();
  }

  if (typeof rawResponse.code === "string" && rawResponse.code.trim()) {
    return rawResponse.code.trim();
  }

  const statusChanges = rawResponse.status_changes;

  if (Array.isArray(statusChanges)) {
    for (let index = statusChanges.length - 1; index >= 0; index -= 1) {
      const entry = asObject(statusChanges[index]);
      const code = readString(entry?.code);

      if (code) {
        return code;
      }
    }
  }

  return "unknown";
}

export type RecallBotTranscriptDiagnostics = {
  transcriptFound: boolean;
  transcriptItemCount: number;
  latestTranscriptText: string | null;
  rawResponse: unknown;
};

export function summarizeRecallBotTranscriptResponse(
  rawResponse: unknown,
): RecallBotTranscriptDiagnostics {
  const items = extractTranscriptItems(rawResponse);
  const latestTranscriptText =
    [...items]
      .reverse()
      .map((item) => extractTranscriptTextFromItem(item))
      .find(Boolean) ??
    readString(asObject(rawResponse)?.text) ??
    readString(asObject(rawResponse)?.transcript) ??
    null;

  return {
    transcriptFound: items.length > 0 || Boolean(latestTranscriptText),
    transcriptItemCount: items.length,
    latestTranscriptText,
    rawResponse,
  };
}

export type RecallBotDetailsDiagnostics = {
  botStatus: string;
  recordingStatus: string | null;
  transcriptConfig: unknown;
  realtimeEndpoints: unknown;
  rawResponse: Record<string, unknown>;
};

export function summarizeRecallBotDetailsResponse(
  rawResponse: Record<string, unknown>,
): RecallBotDetailsDiagnostics {
  const recordingConfig = asObject(rawResponse.recording_config);
  const recording = asObject(rawResponse.recording);

  return {
    botStatus: deriveBotStatus(rawResponse),
    recordingStatus:
      readString(rawResponse.recording_status) ??
      readString(recording?.status) ??
      readString(recording?.code) ??
      null,
    transcriptConfig: recordingConfig?.transcript ?? rawResponse.transcript ?? null,
    realtimeEndpoints:
      recordingConfig?.realtime_endpoints ?? rawResponse.realtime_endpoints ?? null,
    rawResponse,
  };
}
