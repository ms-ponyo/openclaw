import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  id: "google-workspace",
  name: "Google Workspace",
  description: "Gmail and Google Calendar tools via service account",
  register(api: OpenClawPluginApi) {
    api.logger.info("google-workspace plugin loaded");
  },
};

export default plugin;
