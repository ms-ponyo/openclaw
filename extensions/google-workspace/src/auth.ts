import { readFileSync } from "node:fs";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

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

// ── Service Account auth (Google Workspace orgs) ────────────────────

export interface ServiceAccountAuthOptions {
  serviceAccountKey: string;
  delegateEmail: string;
  scopes: string[];
}

export function createServiceAccountAuth(options: ServiceAccountAuthOptions): GoogleAuth {
  const { serviceAccountKey, delegateEmail, scopes } = options;

  let credentials: Record<string, unknown>;
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
    clientOptions: { subject: delegateEmail },
  });
}

// ── OAuth2 refresh token auth (personal Gmail) ─────────────────────

export interface OAuth2AuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function createOAuth2Auth(options: OAuth2AuthOptions): OAuth2Client {
  const client = new OAuth2Client(options.clientId, options.clientSecret);
  client.setCredentials({ refresh_token: options.refreshToken });
  return client;
}

// ── Unified factory ─────────────────────────────────────────────────

export type AuthConfig =
  | { mode: "service-account"; serviceAccountKey: string; delegateEmail: string }
  | { mode: "oauth2"; clientId: string; clientSecret: string; refreshToken: string };

/**
 * Create a Google auth client from plugin config.
 * Supports both service account (Workspace) and OAuth2 refresh token (personal Gmail).
 */
export function createAuthClient(config: AuthConfig, scopes: string[]): GoogleAuth | OAuth2Client {
  if (config.mode === "service-account") {
    return createServiceAccountAuth({
      serviceAccountKey: config.serviceAccountKey,
      delegateEmail: config.delegateEmail,
      scopes,
    });
  }
  // OAuth2 — scopes are baked into the refresh token at consent time
  return createOAuth2Auth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });
}

/**
 * Detect auth mode from plugin config fields.
 */
export function resolveAuthConfig(pluginConfig: Record<string, unknown>): AuthConfig | null {
  // OAuth2 mode (personal Gmail)
  if (pluginConfig.clientId && pluginConfig.clientSecret && pluginConfig.refreshToken) {
    return {
      mode: "oauth2",
      clientId: String(pluginConfig.clientId),
      clientSecret: String(pluginConfig.clientSecret),
      refreshToken: String(pluginConfig.refreshToken),
    };
  }
  // Service account mode (Google Workspace)
  if (pluginConfig.serviceAccountKey && pluginConfig.delegateEmail) {
    return {
      mode: "service-account",
      serviceAccountKey: String(pluginConfig.serviceAccountKey),
      delegateEmail: String(pluginConfig.delegateEmail),
    };
  }
  return null;
}

/**
 * Resolve account configs from plugin config.
 *
 * If the config contains an `accounts` map, each entry is resolved as a
 * separate account, inheriting top-level `clientId`/`clientSecret` as defaults.
 * Otherwise, falls back to a single `"default"` account via `resolveAuthConfig`.
 *
 * Returns null if no valid accounts could be resolved.
 */
export function resolveAccountConfigs(
  pluginConfig: Record<string, unknown>,
): Map<string, AuthConfig> | null {
  const accounts = pluginConfig.accounts as Record<string, Record<string, unknown>> | undefined;

  if (accounts && typeof accounts === "object") {
    const result = new Map<string, AuthConfig>();
    const topClientId = pluginConfig.clientId ? String(pluginConfig.clientId) : undefined;
    const topClientSecret = pluginConfig.clientSecret ? String(pluginConfig.clientSecret) : undefined;

    for (const [id, accountConfig] of Object.entries(accounts)) {
      const merged: Record<string, unknown> = {
        ...(topClientId ? { clientId: topClientId } : {}),
        ...(topClientSecret ? { clientSecret: topClientSecret } : {}),
        ...accountConfig,
      };
      const authConfig = resolveAuthConfig(merged);
      if (authConfig) {
        result.set(id, authConfig);
      }
    }

    return result.size > 0 ? result : null;
  }

  // Legacy single-account fallback
  const authConfig = resolveAuthConfig(pluginConfig);
  if (!authConfig) return null;
  return new Map([["default", authConfig]]);
}
