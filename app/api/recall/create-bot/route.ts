import { NextResponse } from "next/server";
import {
  buildCreateRecallBotPayload,
  createRecallBot,
  getRecallPreflight,
} from "@/lib/recall";
import { getSessionOperationBlockedMessage } from "@/lib/session-operations";
import { getMeetingSessionById, saveRecallBotRecord } from "@/lib/store";
import { FIXED_TRANSCRIPT_LANGUAGE } from "@/lib/transcript-language";
import type { RecallBotRecord } from "@/lib/types";

const DEFAULT_BOT_NAME = "ChatsHero AI Assistant";
const MIN_BOT_COUNT = 1;
const MAX_BOT_COUNT = 20;

function ensureValidUrl(value: string): string {
  if (!value) {
    throw new Error("Zoom meeting URL is required.");
  }

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Zoom meeting URL must start with http:// or https://.");
    }

    return url.toString();
  } catch {
    throw new Error("Zoom meeting URL is invalid.");
  }
}

function ensureValidBotCount(value: number | string | undefined): number {
  const parsed = Math.floor(Number(value ?? 1));

  if (!Number.isFinite(parsed) || parsed < MIN_BOT_COUNT || parsed > MAX_BOT_COUNT) {
    throw new Error(`Number of bots must be between ${MIN_BOT_COUNT} and ${MAX_BOT_COUNT}.`);
  }

  return parsed;
}

function buildBotName(botNamePrefix: string, botCount: number, index: number): string {
  if (botCount === 1) {
    return botNamePrefix;
  }

  return `${botNamePrefix} ${index + 1}`;
}

type FailedBotAttempt = {
  index: number;
  botName: string;
  error: string;
};

type SuccessfulBotCreation = {
  index: number;
  recallBot: RecallBotRecord;
};

function buildDefaultBotNames(botNamePrefix: string, botCount: number): string[] {
  return Array.from({ length: botCount }, (_, index) =>
    buildBotName(botNamePrefix, botCount, index),
  );
}

function ensureValidBotNames(
  botNames: Array<string | null | undefined> | undefined,
  botNamePrefix: string,
  botCount: number,
): string[] {
  if (!botNames) {
    return buildDefaultBotNames(botNamePrefix, botCount);
  }

  if (botNames.length !== botCount) {
    throw new Error("Number of bot names must match Number of Bots.");
  }

  return botNames.map((botName, index) => {
    const trimmedBotName = String(botName ?? "").trim();

    if (!trimmedBotName) {
      throw new Error(`Bot ${index + 1} name is required.`);
    }

    return trimmedBotName;
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      meetingUrl?: string;
      botName?: string;
      botNamePrefix?: string;
      botNames?: string[];
      botCount?: number | string;
    };

    const sessionId = String(body.sessionId ?? "").trim();

    if (!sessionId) {
      throw new Error("Session ID is required.");
    }

    const meetingSession = await getMeetingSessionById(sessionId);

    if (!meetingSession) {
      throw new Error("Meeting session not found.");
    }

    const sessionBlockedMessage = getSessionOperationBlockedMessage(
      meetingSession.status,
    );

    if (sessionBlockedMessage) {
      throw new Error(sessionBlockedMessage);
    }

    if (!meetingSession.zoomUrl.trim()) {
      throw new Error(
        "Selected session has no Zoom URL. Please edit the session and add a Zoom URL before creating bots.",
      );
    }

    const preflight = getRecallPreflight();

    if (preflight.errors.length > 0) {
      throw new Error(preflight.errors.join(" "));
    }

    const meetingUrl = ensureValidUrl(meetingSession.zoomUrl.trim());
    const botNamePrefix =
      (body.botNamePrefix ?? body.botName ?? DEFAULT_BOT_NAME).trim() ||
      DEFAULT_BOT_NAME;
    const transcriptLanguage = FIXED_TRANSCRIPT_LANGUAGE;
    const botCount = ensureValidBotCount(body.botCount);
    const botNames = ensureValidBotNames(body.botNames, botNamePrefix, botCount);

    if (botCount === 1) {
      const createRequestPayload = buildCreateRecallBotPayload({
        meetingUrl,
        botName: botNames[0],
        transcriptLanguage,
        maskAutomationBypassSecret: true,
      });
      const rawRecallResponse = await createRecallBot({
        meetingUrl,
        botName: botNames[0],
        transcriptLanguage,
      });

      const recallBot = await saveRecallBotRecord({
        sessionId,
        meetingUrl,
        botName: botNames[0],
        transcriptLanguage,
        createRequestPayload,
        rawRecallResponse,
      });

      return NextResponse.json({ recallBot }, { status: 201 });
    }

    const successfulBots: SuccessfulBotCreation[] = [];
    const failedAttempts: FailedBotAttempt[] = [];

    for (let index = 0; index < botCount; index += 1) {
      const botName = botNames[index];

      try {
        const createRequestPayload = buildCreateRecallBotPayload({
          meetingUrl,
          botName,
          transcriptLanguage,
          maskAutomationBypassSecret: true,
        });
        const rawRecallResponse = await createRecallBot({
          meetingUrl,
          botName,
          transcriptLanguage,
        });

        const recallBot = await saveRecallBotRecord({
          sessionId,
          meetingUrl,
          botName,
          transcriptLanguage,
          createRequestPayload,
          rawRecallResponse,
        });

        successfulBots.push({
          index: index + 1,
          recallBot,
        });
      } catch (error) {
        failedAttempts.push({
          index: index + 1,
          botName,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create Recall bot.",
        });
      }
    }

    if (successfulBots.length === 0) {
      return NextResponse.json(
        {
          error: "Failed to create all requested Recall bots.",
          successfulBots,
          failedAttempts,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        successfulBots,
        failedAttempts,
      },
      { status: failedAttempts.length > 0 ? 207 : 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create Recall bot.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
