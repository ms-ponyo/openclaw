import { Type } from "@sinclair/typebox";
import { gmail } from "@googleapis/gmail";
import { calendar } from "@googleapis/calendar";
import type { gmail_v1 } from "@googleapis/gmail";
import type { calendar_v3 } from "@googleapis/calendar";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createAuthClient, resolveAccountConfigs, resolveScopes } from "./src/auth.js";
import { json } from "./src/shared.js";
import {
  gmailSearchTool,
  gmailReadTool,
  gmailSendTool,
  gmailReplyTool,
  gmailDraftCreateTool,
  gmailDraftSendTool,
  gmailModifyTool,
  gmailAttachmentGetTool,
} from "./src/gmail/tools.js";
import {
  calendarListCalendarsTool,
  calendarListEventsTool,
  calendarGetEventTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,
  calendarFreebusyTool,
} from "./src/calendar/tools.js";

const GMAIL_TOOL_NAMES = [
  "gmail_search",
  "gmail_read",
  "gmail_send",
  "gmail_reply",
  "gmail_draft_create",
  "gmail_draft_send",
  "gmail_modify",
  "gmail_attachment_get",
];

const CALENDAR_TOOL_NAMES = [
  "calendar_list",
  "calendar_list_events",
  "calendar_get_event",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "calendar_freebusy",
];

const ACCOUNT_TOOL_NAMES = [
  "google_accounts",
];

const plugin = {
  id: "google-workspace",
  name: "Google Workspace",
  description: "Gmail and Google Calendar tools via OAuth2 or service account",
  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const accountConfigs = resolveAccountConfigs(pluginConfig);

    if (!accountConfigs) {
      api.logger.warn(
        "[google-workspace] Missing auth config. Provide either (clientId + clientSecret + refreshToken) for OAuth2, or (serviceAccountKey + delegateEmail) for service account. Skipping tool registration.",
      );
      return;
    }

    const accountIds = [...accountConfigs.keys()];

    // Lazy-caching Gmail client resolver
    const gmailClients = new Map<string, gmail_v1.Gmail>();
    const resolveGmailClient = (accountId?: string): gmail_v1.Gmail => {
      const id = accountId || accountIds[0];
      if (!gmailClients.has(id)) {
        const config = accountConfigs.get(id);
        if (!config) throw new Error(`Unknown Google account: ${id}`);
        const auth = createAuthClient(config, resolveScopes(["gmail"]));
        gmailClients.set(id, gmail({ version: "v1", auth }));
      }
      return gmailClients.get(id)!;
    };

    // Lazy-caching Calendar client resolver
    const calendarClients = new Map<string, calendar_v3.Calendar>();
    const resolveCalendarClient = (accountId?: string): calendar_v3.Calendar => {
      const id = accountId || accountIds[0];
      if (!calendarClients.has(id)) {
        const config = accountConfigs.get(id);
        if (!config) throw new Error(`Unknown Google account: ${id}`);
        const auth = createAuthClient(config, resolveScopes(["google-calendar"]));
        calendarClients.set(id, calendar({ version: "v3", auth }));
      }
      return calendarClients.get(id)!;
    };

    // google_accounts discovery tool
    api.registerTool(
      () => [{
        name: "google_accounts",
        label: "List Google Accounts",
        description: "List configured Google accounts available for Gmail and Calendar tools.",
        parameters: Type.Object({}),
        async execute() { return json({ accounts: accountIds, default: accountIds[0] }); },
      }],
      { names: ACCOUNT_TOOL_NAMES },
    );

    // Gmail tools factory
    api.registerTool(
      () => [
        gmailSearchTool(resolveGmailClient, accountIds),
        gmailReadTool(resolveGmailClient, accountIds),
        gmailSendTool(resolveGmailClient, accountIds),
        gmailReplyTool(resolveGmailClient, accountIds),
        gmailDraftCreateTool(resolveGmailClient, accountIds),
        gmailDraftSendTool(resolveGmailClient, accountIds),
        gmailModifyTool(resolveGmailClient, accountIds),
        gmailAttachmentGetTool(resolveGmailClient, accountIds, api.config.agents?.defaults?.workspace),
      ],
      { names: GMAIL_TOOL_NAMES },
    );

    // Calendar tools factory
    api.registerTool(
      () => [
        calendarListCalendarsTool(resolveCalendarClient, accountIds),
        calendarListEventsTool(resolveCalendarClient, accountIds),
        calendarGetEventTool(resolveCalendarClient, accountIds),
        calendarCreateEventTool(resolveCalendarClient, accountIds),
        calendarUpdateEventTool(resolveCalendarClient, accountIds),
        calendarDeleteEventTool(resolveCalendarClient, accountIds),
        calendarFreebusyTool(resolveCalendarClient, accountIds),
      ],
      { names: CALENDAR_TOOL_NAMES },
    );

    const authModes = [...new Set([...accountConfigs.values()].map((c) =>
      c.mode === "oauth2" ? "OAuth2 refresh token" : "service account",
    ))].join(", ");
    const accountLabel = accountIds.length === 1
      ? `1 account (${accountIds[0]})`
      : `${accountIds.length} accounts (${accountIds.join(", ")})`;

    api.logger.info(`[google-workspace] Registered Gmail and Calendar tools — ${accountLabel}, auth: ${authModes}`);
  },
};

export default plugin;
