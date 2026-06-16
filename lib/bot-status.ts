const ACTIVE_BOT_STATUSES = new Set([
  "created",
  "joining_call",
  "in_waiting_room",
  "in_call_not_recording",
  "in_call_recording",
  "recording_permission_allowed",
  "recording_permission_denied",
]);

const ACTIVE_BOT_STATUS_HINTS = [
  "joining",
  "waiting",
  "in_call",
  "recording",
];

export function isBotActiveStatus(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();

  if (!normalizedStatus) {
    return false;
  }

  if (ACTIVE_BOT_STATUSES.has(normalizedStatus)) {
    return true;
  }

  return ACTIVE_BOT_STATUS_HINTS.some((hint) =>
    normalizedStatus.includes(hint),
  );
}

const IN_CALL_BOT_STATUSES = new Set([
  "in_call_not_recording",
  "in_call_recording",
  "recording_permission_allowed",
  "recording_permission_denied",
]);

export function isBotInCallStatus(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();

  if (!normalizedStatus) {
    return false;
  }

  return IN_CALL_BOT_STATUSES.has(normalizedStatus);
}
