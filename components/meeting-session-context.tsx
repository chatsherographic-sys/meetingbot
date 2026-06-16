"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { readJsonResponse } from "@/components/control-panel-client";
import type { MeetingSession } from "@/lib/types";

const STORAGE_KEY = "recall-zoom-bot-control-panel.current-session-id";

type MeetingSessionContextValue = {
  currentSession: MeetingSession | null;
  currentSessionId: string;
  loading: boolean;
  meetingSessions: MeetingSession[];
  refreshSessions: () => Promise<void>;
  setCurrentSessionId: (sessionId: string) => void;
};

const MeetingSessionContext = createContext<MeetingSessionContextValue | null>(null);

function selectPreferredSession(meetingSessions: MeetingSession[]): MeetingSession | null {
  const latestActiveSession = meetingSessions.find((session) => session.status === "active");
  return latestActiveSession ?? meetingSessions.find((session) => session.id === "default-session") ?? meetingSessions[0] ?? null;
}

export function MeetingSessionProvider({ children }: { children: ReactNode }) {
  const [meetingSessions, setMeetingSessions] = useState<MeetingSession[]>([]);
  const [currentSessionId, setCurrentSessionIdState] = useState("default-session");
  const [loading, setLoading] = useState(true);

  async function loadSessions() {
    const response = await fetch("/api/sessions", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Failed to load meeting sessions.");
    }

    const payload = await readJsonResponse<{ meetingSessions: MeetingSession[] }>(response);
    setMeetingSessions(payload.meetingSessions);

    const storedSessionId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    const storedSession = payload.meetingSessions.find(
      (session) => session.id === storedSessionId,
    );
    const nextSession = storedSession ?? selectPreferredSession(payload.meetingSessions);

    if (nextSession) {
      setCurrentSessionIdState(nextSession.id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, nextSession.id);
      }
    }
  }

  useEffect(() => {
    let active = true;

    void loadSessions()
      .catch(() => {
        // Session list can be retried manually after page load.
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const currentSession = useMemo(
    () =>
      meetingSessions.find((session) => session.id === currentSessionId) ??
      selectPreferredSession(meetingSessions),
    [currentSessionId, meetingSessions],
  );

  function setCurrentSessionId(sessionId: string) {
    setCurrentSessionIdState(sessionId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, sessionId);
    }
  }

  const value = useMemo<MeetingSessionContextValue>(
    () => ({
      currentSession: currentSession ?? null,
      currentSessionId: currentSession?.id ?? "default-session",
      loading,
      meetingSessions,
      refreshSessions: loadSessions,
      setCurrentSessionId,
    }),
    [currentSession, loading, meetingSessions],
  );

  return (
    <MeetingSessionContext.Provider value={value}>
      {children}
    </MeetingSessionContext.Provider>
  );
}

export function useMeetingSession() {
  const context = useContext(MeetingSessionContext);

  if (!context) {
    throw new Error("useMeetingSession must be used within MeetingSessionProvider.");
  }

  return context;
}
