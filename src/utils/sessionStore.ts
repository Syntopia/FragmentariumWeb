export type StoredSessionsMap = Record<string, string>;

const SESSION_STORAGE_KEY = "fragmentarium-web-sessions-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadStoredSessions(): StoredSessionsMap {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (raw === null) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid session storage payload.");
  }

  const next: StoredSessionsMap = {};
  for (const [path, value] of Object.entries(parsed)) {
    if (typeof path !== "string" || path.trim().length === 0) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    next[path] = value;
  }
  return next;
}

export function saveStoredSessions(sessions: StoredSessionsMap): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}
