import { Type } from "@sinclair/typebox";
import type { calendar_v3 } from "@googleapis/calendar";

import { json, errorResult, withRetry } from "../shared.js";
import type { CalendarEventSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatEvent(
  event: calendar_v3.Schema$Event,
): CalendarEventSummary {
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date ?? "";

  const result: CalendarEventSummary = {
    id: event.id ?? "",
    summary: event.summary ?? "(no title)",
    start,
    end,
    status: event.status ?? "confirmed",
  };

  if (event.description) result.description = event.description;
  if (event.location) result.location = event.location;
  if (event.htmlLink) result.htmlLink = event.htmlLink;

  if (event.attendees && event.attendees.length > 0) {
    result.attendees = event.attendees.map((a) => {
      const attendee: CalendarEventSummary["attendees"] extends
        | Array<infer T>
        | undefined
        ? T
        : never = {
        email: a.email ?? "",
      };
      if (a.displayName) attendee.displayName = a.displayName;
      if (a.responseStatus) attendee.responseStatus = a.responseStatus;
      return attendee;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function calendarListCalendarsTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_list",
    label: "List Calendars",
    description:
      "List all calendars the user has access to, including their IDs. Use this to discover calendar IDs for other tools.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: Record<string, unknown>) {
      try {
        const res = await withRetry(() => calendar.calendarList.list());
        const calendars = (res.data.items ?? []).map((c) => ({
          id: c.id ?? "",
          summary: c.summary ?? "(no title)",
          primary: c.primary ?? false,
          accessRole: c.accessRole ?? "",
          ...(c.description ? { description: c.description } : {}),
          ...(c.backgroundColor ? { color: c.backgroundColor } : {}),
        }));
        return json({ calendars, count: calendars.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarListEventsTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_list_events",
    label: "List Calendar Events",
    description:
      "List events from a Google Calendar within a time range. Defaults to the primary calendar and the next 7 days.",
    parameters: Type.Object({
      calendarId: Type.Optional(
        Type.String({ description: "Calendar ID (default: primary)" }),
      ),
      timeMin: Type.Optional(
        Type.String({
          description: "Start of time range (ISO 8601). Defaults to now.",
        }),
      ),
      timeMax: Type.Optional(
        Type.String({
          description:
            "End of time range (ISO 8601). Defaults to 7 days from now.",
        }),
      ),
      maxResults: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 50,
          description: "Max events to return (1-50, default 20)",
        }),
      ),
      query: Type.Optional(
        Type.String({ description: "Free-text search query" }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId =
        (typeof params.calendarId === "string" && params.calendarId.trim()) ||
        "primary";
      const now = new Date().toISOString();
      const timeMin =
        (typeof params.timeMin === "string" && params.timeMin.trim()) || now;
      const timeMax =
        (typeof params.timeMax === "string" && params.timeMax.trim()) ||
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const maxResults =
        typeof params.maxResults === "number"
          ? Math.min(50, Math.max(1, Math.round(params.maxResults)))
          : 20;
      const query =
        typeof params.query === "string" ? params.query.trim() : undefined;

      try {
        const res = await withRetry(() =>
          calendar.events.list({
            calendarId,
            timeMin,
            timeMax,
            maxResults,
            singleEvents: true,
            orderBy: "startTime",
            ...(query ? { q: query } : {}),
          }),
        );

        const events = (res.data.items ?? []).map(formatEvent);
        return json({
          events,
          total: events.length,
          calendarId,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarGetEventTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_get_event",
    label: "Get Calendar Event",
    description: "Get a single event from a Google Calendar by its event ID.",
    parameters: Type.Object({
      calendarId: Type.Optional(
        Type.String({ description: "Calendar ID (default: primary)" }),
      ),
      eventId: Type.String({ description: "The event ID to retrieve" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId =
        (typeof params.calendarId === "string" && params.calendarId.trim()) ||
        "primary";
      const eventId =
        typeof params.eventId === "string" ? params.eventId.trim() : "";
      if (!eventId) {
        return errorResult(new Error("eventId required"));
      }

      try {
        const res = await withRetry(() =>
          calendar.events.get({ calendarId, eventId }),
        );
        return json(formatEvent(res.data));
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarCreateEventTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_create_event",
    label: "Create Calendar Event",
    description: "Create a new event on a Google Calendar.",
    parameters: Type.Object({
      calendarId: Type.Optional(
        Type.String({ description: "Calendar ID (default: primary)" }),
      ),
      summary: Type.String({ description: "Event title" }),
      start: Type.String({
        description: "Start time in ISO 8601 format",
      }),
      end: Type.String({
        description: "End time in ISO 8601 format",
      }),
      description: Type.Optional(
        Type.String({ description: "Event description" }),
      ),
      location: Type.Optional(
        Type.String({ description: "Event location" }),
      ),
      attendees: Type.Optional(
        Type.Array(Type.String(), {
          description: "Array of attendee email addresses",
        }),
      ),
      sendUpdates: Type.Optional(
        Type.Unsafe<"all" | "externalOnly" | "none">({
          type: "string",
          enum: ["all", "externalOnly", "none"],
          description:
            "Whether to send notifications (all, externalOnly, none)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId =
        (typeof params.calendarId === "string" && params.calendarId.trim()) ||
        "primary";
      const summary =
        typeof params.summary === "string" ? params.summary.trim() : "";
      if (!summary) {
        return errorResult(new Error("summary required"));
      }
      const start = typeof params.start === "string" ? params.start.trim() : "";
      if (!start) {
        return errorResult(new Error("start required"));
      }
      const end = typeof params.end === "string" ? params.end.trim() : "";
      if (!end) {
        return errorResult(new Error("end required"));
      }

      const requestBody: calendar_v3.Schema$Event = {
        summary,
        start: { dateTime: start },
        end: { dateTime: end },
      };

      if (typeof params.description === "string" && params.description.trim()) {
        requestBody.description = params.description.trim();
      }
      if (typeof params.location === "string" && params.location.trim()) {
        requestBody.location = params.location.trim();
      }
      if (Array.isArray(params.attendees)) {
        requestBody.attendees = params.attendees
          .filter((e): e is string => typeof e === "string" && !!e.trim())
          .map((email) => ({ email: email.trim() }));
      }

      const sendUpdates =
        typeof params.sendUpdates === "string"
          ? (params.sendUpdates as "all" | "externalOnly" | "none")
          : undefined;

      try {
        const res = await withRetry(() =>
          calendar.events.insert({
            calendarId,
            requestBody,
            ...(sendUpdates ? { sendUpdates } : {}),
          }),
        );
        return json(formatEvent(res.data));
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarUpdateEventTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_update_event",
    label: "Update Calendar Event",
    description:
      "Update an existing event on a Google Calendar. Only provided fields are modified.",
    parameters: Type.Object({
      calendarId: Type.Optional(
        Type.String({ description: "Calendar ID (default: primary)" }),
      ),
      eventId: Type.String({ description: "The event ID to update" }),
      summary: Type.Optional(Type.String({ description: "Event title" })),
      start: Type.Optional(
        Type.String({ description: "Start time in ISO 8601 format" }),
      ),
      end: Type.Optional(
        Type.String({ description: "End time in ISO 8601 format" }),
      ),
      description: Type.Optional(
        Type.String({ description: "Event description" }),
      ),
      location: Type.Optional(
        Type.String({ description: "Event location" }),
      ),
      attendees: Type.Optional(
        Type.Array(Type.String(), {
          description: "Array of attendee email addresses",
        }),
      ),
      sendUpdates: Type.Optional(
        Type.Unsafe<"all" | "externalOnly" | "none">({
          type: "string",
          enum: ["all", "externalOnly", "none"],
          description:
            "Whether to send notifications (all, externalOnly, none)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId =
        (typeof params.calendarId === "string" && params.calendarId.trim()) ||
        "primary";
      const eventId =
        typeof params.eventId === "string" ? params.eventId.trim() : "";
      if (!eventId) {
        return errorResult(new Error("eventId required"));
      }

      const requestBody: calendar_v3.Schema$Event = {};

      if (typeof params.summary === "string") {
        requestBody.summary = params.summary.trim();
      }
      if (typeof params.start === "string" && params.start.trim()) {
        requestBody.start = { dateTime: params.start.trim() };
      }
      if (typeof params.end === "string" && params.end.trim()) {
        requestBody.end = { dateTime: params.end.trim() };
      }
      if (typeof params.description === "string") {
        requestBody.description = params.description.trim();
      }
      if (typeof params.location === "string") {
        requestBody.location = params.location.trim();
      }
      if (Array.isArray(params.attendees)) {
        requestBody.attendees = params.attendees
          .filter((e): e is string => typeof e === "string" && !!e.trim())
          .map((email) => ({ email: email.trim() }));
      }

      const sendUpdates =
        typeof params.sendUpdates === "string"
          ? (params.sendUpdates as "all" | "externalOnly" | "none")
          : undefined;

      try {
        const res = await withRetry(() =>
          calendar.events.patch({
            calendarId,
            eventId,
            requestBody,
            ...(sendUpdates ? { sendUpdates } : {}),
          }),
        );
        return json(formatEvent(res.data));
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarDeleteEventTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_delete_event",
    label: "Delete Calendar Event",
    description: "Delete an event from a Google Calendar.",
    parameters: Type.Object({
      calendarId: Type.Optional(
        Type.String({ description: "Calendar ID (default: primary)" }),
      ),
      eventId: Type.String({ description: "The event ID to delete" }),
      sendUpdates: Type.Optional(
        Type.Unsafe<"all" | "externalOnly" | "none">({
          type: "string",
          enum: ["all", "externalOnly", "none"],
          description:
            "Whether to send notifications (all, externalOnly, none)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const calendarId =
        (typeof params.calendarId === "string" && params.calendarId.trim()) ||
        "primary";
      const eventId =
        typeof params.eventId === "string" ? params.eventId.trim() : "";
      if (!eventId) {
        return errorResult(new Error("eventId required"));
      }

      const sendUpdates =
        typeof params.sendUpdates === "string"
          ? (params.sendUpdates as "all" | "externalOnly" | "none")
          : undefined;

      try {
        await withRetry(() =>
          calendar.events.delete({
            calendarId,
            eventId,
            ...(sendUpdates ? { sendUpdates } : {}),
          }),
        );
        return json({ deleted: true, eventId });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function calendarFreebusyTool(calendar: calendar_v3.Calendar) {
  return {
    name: "calendar_freebusy",
    label: "Check Free/Busy",
    description:
      "Query the free/busy status for one or more users within a time range.",
    parameters: Type.Object({
      timeMin: Type.String({
        description: "Start of time range (ISO 8601)",
      }),
      timeMax: Type.String({
        description: "End of time range (ISO 8601)",
      }),
      emails: Type.Array(Type.String(), {
        description: "Array of email addresses to check availability for",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const timeMin =
        typeof params.timeMin === "string" ? params.timeMin.trim() : "";
      if (!timeMin) {
        return errorResult(new Error("timeMin required"));
      }
      const timeMax =
        typeof params.timeMax === "string" ? params.timeMax.trim() : "";
      if (!timeMax) {
        return errorResult(new Error("timeMax required"));
      }

      if (!Array.isArray(params.emails) || params.emails.length === 0) {
        return errorResult(new Error("emails required"));
      }

      const emails = params.emails.filter(
        (e): e is string => typeof e === "string" && !!e.trim(),
      );

      try {
        const res = await withRetry(() =>
          calendar.freebusy.query({
            requestBody: {
              timeMin,
              timeMax,
              items: emails.map((email) => ({ id: email.trim() })),
            },
          }),
        );

        const calendars = res.data.calendars ?? {};
        const availability = emails.map((email) => {
          const cal = calendars[email];
          return {
            email,
            busy: (cal?.busy ?? []).map((period) => ({
              start: period.start ?? "",
              end: period.end ?? "",
            })),
            errors: cal?.errors?.map((e) => e.reason ?? String(e)) ?? [],
          };
        });

        return json({ availability, timeMin, timeMax });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}
