import type { MeetingSessionStatus } from "@/lib/types";

export function isSessionActiveForOperations(
  status: MeetingSessionStatus | string | undefined,
): boolean {
  return status === "active";
}

export function getSessionOperationBlockedMessage(
  status: MeetingSessionStatus | string | undefined,
): string | null {
  if (status === "ended" || status === "archived") {
    return "This session is ended/archived.";
  }

  if (status && status !== "active") {
    return "This session is not active yet.";
  }

  return null;
}
