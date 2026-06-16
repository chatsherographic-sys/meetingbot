function getRequiredEnvVar(name: "RECALL_API_KEY" | "RECALL_REGION"): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isLocalWebhookBaseUrl(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|::1/i.test(baseUrl);
}

function buildRecallBotEndpoint(pathname: string): string {
  const region = getRequiredEnvVar("RECALL_REGION");
  return `https://${region}.recall.ai${pathname}`;
}

function getRecallAuthorizationHeader(): string {
  const apiKey = getRequiredEnvVar("RECALL_API_KEY");
  return `Token ${apiKey}`;
}

function extractRecallErrorCode(responseJson: unknown): string | null {
  if (!responseJson || typeof responseJson !== "object" || Array.isArray(responseJson)) {
    return null;
  }

  const record = responseJson as Record<string, unknown>;

  if (typeof record.code === "string") {
    return record.code;
  }

  if (
    record.error &&
    typeof record.error === "object" &&
    !Array.isArray(record.error) &&
    typeof (record.error as Record<string, unknown>).code === "string"
  ) {
    return (record.error as Record<string, unknown>).code as string;
  }

  return null;
}

export class RecallApiError extends Error {
  endpoint: string;
  httpStatus: number;
  recallCode: string | null;
  responseBody: unknown;

  constructor(input: {
    message: string;
    endpoint: string;
    httpStatus: number;
    responseBody: unknown;
  }) {
    super(input.message);
    this.name = "RecallApiError";
    this.endpoint = input.endpoint;
    this.httpStatus = input.httpStatus;
    this.responseBody = input.responseBody;
    this.recallCode = extractRecallErrorCode(input.responseBody);
  }
}

export function getFriendlyRecallStopErrorMessage(error: unknown): string | null {
  const recallCode =
    error instanceof RecallApiError
      ? error.recallCode
      : error instanceof Error && error.message.includes("cannot_command_")
        ? error.message
        : null;

  if (
    recallCode === "cannot_command_completed_bot" ||
    recallCode === "cannot_command_unstarted_bot" ||
    (typeof recallCode === "string" &&
      (recallCode.includes("cannot_command_completed_bot") ||
        recallCode.includes("cannot_command_unstarted_bot")))
  ) {
    return "This bot is already ended or not currently in a call.";
  }

  return null;
}

async function parseRecallResponse<T>(
  response: Response,
  errorPrefix: string,
  endpoint = response.url,
): Promise<T> {
  const responseText = await response.text();
  let responseJson: unknown = {};

  if (responseText) {
    try {
      responseJson = JSON.parse(responseText) as unknown;
    } catch {
      responseJson = { raw: responseText };
    }
  }

  if (!response.ok) {
    const responseObject =
      responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)
        ? (responseJson as Record<string, unknown>)
        : null;
    const details =
      typeof responseObject?.raw === "string"
        ? responseObject.raw.trim()
        : responseText.trim();

    throw new RecallApiError({
      message: details
        ? `${errorPrefix} (${response.status}): ${details}`
        : `${errorPrefix} (${response.status}).`,
      endpoint,
      httpStatus: response.status,
      responseBody: responseJson,
    });
  }

  return responseJson as T;
}

export function isRecallSendChatEnabled(): boolean {
  return process.env.RECALL_SEND_CHAT_ENABLED?.trim().toLowerCase() === "true";
}

export function getRecallPreflight(): {
  recallApiKeyConfigured: boolean;
  recallRegionConfigured: boolean;
  publicWebhookBaseUrlConfigured: boolean;
  publicWebhookBaseUrl: string;
  webhookUrl: string;
  errors: string[];
  warnings: string[];
} {
  const recallApiKey = process.env.RECALL_API_KEY?.trim() ?? "";
  const recallRegion = process.env.RECALL_REGION?.trim() ?? "";
  const publicWebhookBaseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL?.trim() ?? "";
  const normalizedBaseUrl = normalizeBaseUrl(
    publicWebhookBaseUrl || "http://localhost:3000",
  );
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!recallApiKey) {
    errors.push("RECALL_API_KEY is not set.");
  }

  if (!recallRegion) {
    errors.push("RECALL_REGION is not set.");
  }

  if (!publicWebhookBaseUrl) {
    errors.push("PUBLIC_WEBHOOK_BASE_URL is not set.");
  }

  if (isLocalWebhookBaseUrl(normalizedBaseUrl)) {
    warnings.push(
      "PUBLIC_WEBHOOK_BASE_URL points to localhost. Real Recall webhooks cannot reach localhost directly.",
    );
  }

  return {
    recallApiKeyConfigured: Boolean(recallApiKey),
    recallRegionConfigured: Boolean(recallRegion),
    publicWebhookBaseUrlConfigured: Boolean(publicWebhookBaseUrl),
    publicWebhookBaseUrl: normalizedBaseUrl,
    webhookUrl: `${normalizedBaseUrl}/api/recall/webhook`,
    errors,
    warnings,
  };
}

export function getPublicWebhookBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.PUBLIC_WEBHOOK_BASE_URL?.trim() || "http://localhost:3000",
  );
}

export function getRecallWebhookUrl(): string {
  return `${getPublicWebhookBaseUrl()}/api/recall/webhook`;
}

export function buildCreateRecallBotPayload(input: {
  meetingUrl: string;
  botName: string;
  transcriptLanguage: string;
}): Record<string, unknown> {
  const webhookUrl = getRecallWebhookUrl();

  return {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    chat: {
      on_bot_join: {
        send_to: "everyone",
        message: "Bot joined. Please ignore me, sorry.",
      },
    },
    recording_config: {
      transcript: {
        provider: {
          deepgram_streaming: {
            model: "nova-3",
            language: input.transcriptLanguage,
          },
        },
        diarization: {
          use_separate_streams_when_available: true,
        },
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: webhookUrl,
          events: ["transcript.data"],
        },
      ],
    },
  };
}

export async function sendRecallChatMessage(
  botId: string,
  message: string,
): Promise<void> {
  const apiKey = getRequiredEnvVar("RECALL_API_KEY");
  const endpoint = buildRecallBotEndpoint(
    `/api/v1/bot/${botId}/send_chat_message/`,
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: "everyone",
      message,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const responseText = await response.text();
    const details = responseText.trim();

    throw new Error(
      details
        ? `Recall send_chat_message failed (${response.status}): ${details}`
        : `Recall send_chat_message failed (${response.status}).`,
    );
  }
}

export async function createRecallBot(input: {
  meetingUrl: string;
  botName: string;
  transcriptLanguage: string;
}): Promise<Record<string, unknown>> {
  const endpoint = buildRecallBotEndpoint("/api/v1/bot/");
  const payload = buildCreateRecallBotPayload(input);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getRecallAuthorizationHeader(),
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  return parseRecallResponse<Record<string, unknown>>(
    response,
    "Recall create bot failed",
  );
}

export async function getRecallBot(
  botId: string,
): Promise<Record<string, unknown>> {
  const endpoint = buildRecallBotEndpoint(`/api/v1/bot/${botId}/`);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: getRecallAuthorizationHeader(),
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  return parseRecallResponse<Record<string, unknown>>(
    response,
    "Recall get bot failed",
  );
}

export async function getRecallBotTranscript(
  botId: string,
): Promise<unknown> {
  const endpoint = buildRecallBotEndpoint(`/api/v1/bot/${botId}/transcript/`);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: getRecallAuthorizationHeader(),
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  return parseRecallResponse<unknown>(response, "Recall get bot transcript failed");
}

export async function stopRecallBot(
  botId: string,
): Promise<{
  endpoint: string;
  httpStatus: number;
  responseBody: Record<string, unknown>;
}> {
  const endpoint = buildRecallBotEndpoint(`/api/v1/bot/${botId}/leave_call/`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: getRecallAuthorizationHeader(),
      accept: "application/json",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  const responseBody = await parseRecallResponse<Record<string, unknown>>(
    response,
    "Recall stop bot failed",
    endpoint,
  );

  return {
    endpoint,
    httpStatus: response.status,
    responseBody,
  };
}
