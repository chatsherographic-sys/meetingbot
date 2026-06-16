"use client";

import { useEffect, useState } from "react";
import type {
  MatchLog,
  PaginationMeta,
  RecallBotRecord,
  TimerTrigger,
  TranscriptLog,
  TriggerRule,
  WebhookDebugLog,
} from "@/lib/types";

export type ControlPanelData = {
  triggerRules: TriggerRule[];
  timerTriggers: TimerTrigger[];
  transcriptLogs: TranscriptLog[];
  matchLogs: MatchLog[];
  recallBots: RecallBotRecord[];
  webhookDebugLogs: WebhookDebugLog[];
};

export type PanelMessage = {
  type: "success" | "error";
  text: string;
} | null;

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export type ListPagination = PaginationMeta;

const initialControlPanelData: ControlPanelData = {
  triggerRules: [],
  timerTriggers: [],
  transcriptLogs: [],
  matchLogs: [],
  recallBots: [],
  webhookDebugLogs: [],
};

export function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function buildQueryString(
  params: Record<string, string | number | null | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

async function fetchControlPanelData(): Promise<ControlPanelData> {
  return fetchControlPanelDataForSession();
}

async function fetchControlPanelDataForSession(
  sessionId?: string,
): Promise<ControlPanelData> {
  const [
    rulesResponse,
    logsResponse,
    botsResponse,
    timerTriggersResponse,
  ] = await Promise.all([
    fetch(
      buildQueryString({ sessionId })
        ? `/api/trigger-rules${buildQueryString({ sessionId })}`
        : "/api/trigger-rules",
      { cache: "no-store" },
    ),
    fetch(buildQueryString({ sessionId }) ? `/api/logs${buildQueryString({ sessionId })}` : "/api/logs", { cache: "no-store" }),
    fetch(buildQueryString({ sessionId }) ? `/api/recall/bots${buildQueryString({ sessionId })}` : "/api/recall/bots", { cache: "no-store" }),
    fetch(`/api/timer-triggers${buildQueryString({ pageSize: 200, sessionId })}`, {
      cache: "no-store",
    }),
  ]);

  if (
    !rulesResponse.ok ||
    !logsResponse.ok ||
    !botsResponse.ok ||
    !timerTriggersResponse.ok
  ) {
    throw new Error("Failed to load control panel data.");
  }

  const rulesPayload = await readJsonResponse<{
    triggerRules: TriggerRule[];
  }>(rulesResponse);
  const logsPayload = await readJsonResponse<{
    transcriptLogs: TranscriptLog[];
    matchLogs: MatchLog[];
    webhookDebugLogs: WebhookDebugLog[];
  }>(logsResponse);
  const botsPayload = await readJsonResponse<{
    recallBots: RecallBotRecord[];
  }>(botsResponse);
  const timerTriggersPayload = await readJsonResponse<{
    timerTriggers: TimerTrigger[];
  }>(timerTriggersResponse);

  return {
    triggerRules: rulesPayload.triggerRules,
    timerTriggers: timerTriggersPayload.timerTriggers,
    transcriptLogs: logsPayload.transcriptLogs,
    matchLogs: logsPayload.matchLogs,
    recallBots: botsPayload.recallBots,
    webhookDebugLogs: logsPayload.webhookDebugLogs,
  };
}

export function useControlPanelData(options?: { pollMs?: number; sessionId?: string }) {
  const [data, setData] = useState<ControlPanelData>(initialControlPanelData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollMs = options?.pollMs ?? 0;
  const sessionId = options?.sessionId;

  async function reload() {
    const nextData = await fetchControlPanelDataForSession(sessionId);
    setData(nextData);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const nextData = await fetchControlPanelDataForSession(sessionId);
        if (!active) {
          return;
        }

        setData(nextData);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load control panel data.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    if (pollMs <= 0) {
      return () => {
        active = false;
      };
    }

    const interval = window.setInterval(() => {
      void fetchControlPanelDataForSession(sessionId)
        .then((nextData) => {
          if (!active) {
            return;
          }

          setData(nextData);
          setError(null);
        })
        .catch(() => {
          // The next polling cycle can recover without interrupting the page.
        });
    }, pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pollMs, sessionId]);

  return {
    data,
    loading,
    error,
    reload,
  };
}
