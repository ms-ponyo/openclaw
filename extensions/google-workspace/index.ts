import { gmail } from "@googleapis/gmail";
import { calendar } from "@googleapis/calendar";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createAuthClient, resolveAuthConfig, resolveScopes } from "./src/auth.js";
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
  "calendar_list_events",
  "calendar_get_event",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "calendar_freebusy",
];

const plugin = {
  id: "google-workspace",
  name: "Google Workspace",
  description: "Gmail and Google Calendar tools via OAuth2 or service account",
  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const authConfig = resolveAuthConfig(pluginConfig);

    if (!authConfig) {
      api.logger.warn(
        "[google-workspace] Missing auth config. Provide either (clientId + clientSecret + refreshToken) for OAuth2, or (serviceAccountKey + delegateEmail) for service account. Skipping tool registration.",
      );
      return;
    }

    const authMode = authConfig.mode === "oauth2" ? "OAuth2 refresh token" : "service account";

    // Gmail tools factory
    api.registerTool(
      () => {
        const scopes = resolveScopes(["gmail"]);
        const auth = createAuthClient(authConfig, scopes);
        const gmailClient = gmail({ version: "v1", auth });

        return [
          gmailSearchTool(gmailClient),
          gmailReadTool(gmailClient),
          gmailSendTool(gmailClient),
          gmailReplyTool(gmailClient),
          gmailDraftCreateTool(gmailClient),
          gmailDraftSendTool(gmailClient),
          gmailModifyTool(gmailClient),
          gmailAttachmentGetTool(gmailClient),
        ];
      },
      { names: GMAIL_TOOL_NAMES },
    );

    // Calendar tools factory
    api.registerTool(
      () => {
        const scopes = resolveScopes(["google-calendar"]);
        const auth = createAuthClient(authConfig, scopes);
        const calendarClient = calendar({ version: "v3", auth });

        return [
          calendarListEventsTool(calendarClient),
          calendarGetEventTool(calendarClient),
          calendarCreateEventTool(calendarClient),
          calendarUpdateEventTool(calendarClient),
          calendarDeleteEventTool(calendarClient),
          calendarFreebusyTool(calendarClient),
        ];
      },
      { names: CALENDAR_TOOL_NAMES },
    );

    api.logger.info(`[google-workspace] Registered Gmail and Calendar tools (${authMode})`);
  },
};

export default plugin;
