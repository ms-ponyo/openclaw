import { gmail } from "@googleapis/gmail";
import { calendar } from "@googleapis/calendar";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createAuthClient, resolveScopes } from "./src/auth.js";
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
  description: "Gmail and Google Calendar tools via service account",
  register(api: OpenClawPluginApi) {
    const serviceAccountKey = api.pluginConfig?.serviceAccountKey as string | undefined;
    const delegateEmail = api.pluginConfig?.delegateEmail as string | undefined;

    if (!serviceAccountKey || !delegateEmail) {
      api.logger.warn(
        "[google-workspace] Missing serviceAccountKey or delegateEmail in plugin config — skipping tool registration",
      );
      return;
    }

    // Gmail tools factory
    api.registerTool(
      () => {
        const scopes = resolveScopes(["gmail"]);
        const auth = createAuthClient({ serviceAccountKey, delegateEmail, scopes });
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
        const auth = createAuthClient({ serviceAccountKey, delegateEmail, scopes });
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

    api.logger.info("[google-workspace] Registered Gmail and Calendar tools");
  },
};

export default plugin;
