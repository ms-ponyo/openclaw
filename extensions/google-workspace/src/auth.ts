import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

/** Mapping from skill name to the Google OAuth scopes it requires. */
const SKILL_SCOPES: Record<string, string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  "google-calendar": [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
};

/**
 * Map an array of skill names to the union of their required Google OAuth scopes.
 * Unknown skill names are silently ignored. The returned array is deduplicated.
 */
export function resolveScopes(skills: string[]): string[] {
  const seen = new Set<string>();
  for (const skill of skills) {
    const scopes = SKILL_SCOPES[skill];
    if (scopes) {
      for (const scope of scopes) {
        seen.add(scope);
      }
    }
  }
  return [...seen];
}

export interface AuthClientOptions {
  /** Path to a service-account JSON key file, or the JSON key as a string. */
  serviceAccountKey: string;
  /** The Google Workspace user email to impersonate via domain-wide delegation. */
  delegateEmail: string;
  /** OAuth scopes the client should request. */
  scopes: string[];
}

/**
 * Create a `GoogleAuth` client configured for domain-wide delegation using a
 * service-account key.
 *
 * `serviceAccountKey` may be either:
 *   - A file-system path to the JSON key file, or
 *   - The JSON key content as a string.
 */
export function createAuthClient(options: AuthClientOptions): GoogleAuth {
  const { serviceAccountKey, delegateEmail, scopes } = options;

  let credentials: Record<string, unknown>;

  // Determine whether the value is inline JSON or a file path.
  const trimmed = serviceAccountKey.trim();
  if (trimmed.startsWith("{")) {
    credentials = JSON.parse(trimmed) as Record<string, unknown>;
  } else {
    const raw = readFileSync(trimmed, "utf-8");
    credentials = JSON.parse(raw) as Record<string, unknown>;
  }

  return new GoogleAuth({
    credentials,
    scopes,
    clientOptions: {
      subject: delegateEmail,
    },
  });
}
