import { describe, it, expect, vi } from "vitest";
import type { calendar_v3 } from "@googleapis/calendar";

import {
  calendarListEventsTool,
  calendarGetEventTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,
  calendarFreebusyTool,
  formatEvent,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function mockCalendar() {
  return {
    events: {
      list: vi.fn(),
      get: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    freebusy: {
      query: vi.fn(),
    },
  } as unknown as calendar_v3.Calendar;
}

const sampleEvent: calendar_v3.Schema$Event = {
  id: "evt-1",
  summary: "Team standup",
  description: "Daily standup",
  location: "Zoom",
  start: { dateTime: "2026-02-21T09:00:00Z" },
  end: { dateTime: "2026-02-21T09:30:00Z" },
  status: "confirmed",
  htmlLink: "https://calendar.google.com/event/evt-1",
  attendees: [
    { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted" },
    { email: "bob@example.com", responseStatus: "needsAction" },
  ],
};

const allDayEvent: calendar_v3.Schema$Event = {
  id: "evt-2",
  summary: "Company holiday",
  start: { date: "2026-03-01" },
  end: { date: "2026-03-02" },
  status: "confirmed",
};

// ---------------------------------------------------------------------------
// formatEvent
// ---------------------------------------------------------------------------

describe("formatEvent", () => {
  it("formats a dateTime-based event with attendees", () => {
    const result = formatEvent(sampleEvent);
    expect(result).toEqual({
      id: "evt-1",
      summary: "Team standup",
      description: "Daily standup",
      location: "Zoom",
      start: "2026-02-21T09:00:00Z",
      end: "2026-02-21T09:30:00Z",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event/evt-1",
      attendees: [
        { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted" },
        { email: "bob@example.com", responseStatus: "needsAction" },
      ],
    });
  });

  it("formats an all-day event (date only)", () => {
    const result = formatEvent(allDayEvent);
    expect(result).toEqual({
      id: "evt-2",
      summary: "Company holiday",
      start: "2026-03-01",
      end: "2026-03-02",
      status: "confirmed",
    });
  });

  it("handles missing optional fields gracefully", () => {
    const result = formatEvent({ id: "x", status: "tentative" });
    expect(result.id).toBe("x");
    expect(result.summary).toBe("(no title)");
    expect(result.start).toBe("");
    expect(result.end).toBe("");
    expect(result.status).toBe("tentative");
    expect(result.description).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.htmlLink).toBeUndefined();
    expect(result.attendees).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// calendar_list_events
// ---------------------------------------------------------------------------

describe("calendar_list_events", () => {
  it("lists events with default parameters", async () => {
    const cal = mockCalendar();
    (cal.events.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { items: [sampleEvent, allDayEvent] },
    });

    const tool = calendarListEventsTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", {});
    const data = parse(result);

    expect(data.events).toHaveLength(2);
    expect(data.events[0].id).toBe("evt-1");
    expect(data.events[1].id).toBe("evt-2");
    expect(data.total).toBe(2);
    expect(data.calendarId).toBe("primary");

    expect(cal.events.list).toHaveBeenCalledOnce();
    const args = (cal.events.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.calendarId).toBe("primary");
    expect(args.singleEvents).toBe(true);
    expect(args.orderBy).toBe("startTime");
    expect(args.maxResults).toBe(20);
  });

  it("passes custom calendarId, query, and maxResults", async () => {
    const cal = mockCalendar();
    (cal.events.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { items: [] },
    });

    const tool = calendarListEventsTool(() => cal, ["default"]);
    await tool.execute("call-2", {
      calendarId: "team@example.com",
      query: "standup",
      maxResults: 5,
    });

    const args = (cal.events.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.calendarId).toBe("team@example.com");
    expect(args.q).toBe("standup");
    expect(args.maxResults).toBe(5);
  });

  it("clamps maxResults to 1-50 range", async () => {
    const cal = mockCalendar();
    (cal.events.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { items: [] },
    });

    const tool = calendarListEventsTool(() => cal, ["default"]);

    await tool.execute("call-3", { maxResults: 100 });
    expect((cal.events.list as ReturnType<typeof vi.fn>).mock.calls[0][0].maxResults).toBe(50);

    await tool.execute("call-4", { maxResults: -5 });
    expect((cal.events.list as ReturnType<typeof vi.fn>).mock.calls[1][0].maxResults).toBe(1);
  });

  it("returns error on API failure", async () => {
    const cal = mockCalendar();
    (cal.events.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Not Found"),
    );

    const tool = calendarListEventsTool(() => cal, ["default"]);
    const result = await tool.execute("call-5", {});
    const data = parse(result);
    expect(data.error).toBe("Not Found");
  });
});

// ---------------------------------------------------------------------------
// calendar_get_event
// ---------------------------------------------------------------------------

describe("calendar_get_event", () => {
  it("gets a single event by id", async () => {
    const cal = mockCalendar();
    (cal.events.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: sampleEvent,
    });

    const tool = calendarGetEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", { eventId: "evt-1" });
    const data = parse(result);

    expect(data.id).toBe("evt-1");
    expect(data.summary).toBe("Team standup");
    expect(cal.events.get).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-1",
    });
  });

  it("returns error when eventId is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarGetEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-2", {});
    const data = parse(result);
    expect(data.error).toBe("eventId required");
  });
});

// ---------------------------------------------------------------------------
// calendar_create_event
// ---------------------------------------------------------------------------

describe("calendar_create_event", () => {
  it("creates an event with attendees", async () => {
    const cal = mockCalendar();
    const createdEvent: calendar_v3.Schema$Event = {
      ...sampleEvent,
      id: "new-evt",
    };
    (cal.events.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: createdEvent,
    });

    const tool = calendarCreateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", {
      summary: "Team standup",
      start: "2026-02-21T09:00:00Z",
      end: "2026-02-21T09:30:00Z",
      description: "Daily standup",
      location: "Zoom",
      attendees: ["alice@example.com", "bob@example.com"],
      sendUpdates: "all",
    });

    const data = parse(result);
    expect(data.id).toBe("new-evt");
    expect(data.summary).toBe("Team standup");

    const args = (cal.events.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.calendarId).toBe("primary");
    expect(args.sendUpdates).toBe("all");
    expect(args.requestBody.summary).toBe("Team standup");
    expect(args.requestBody.start).toEqual({ dateTime: "2026-02-21T09:00:00Z" });
    expect(args.requestBody.end).toEqual({ dateTime: "2026-02-21T09:30:00Z" });
    expect(args.requestBody.attendees).toEqual([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
    ]);
  });

  it("returns error when summary is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarCreateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-2", {
      start: "2026-02-21T09:00:00Z",
      end: "2026-02-21T09:30:00Z",
    });
    const data = parse(result);
    expect(data.error).toBe("summary required");
  });

  it("returns error when start is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarCreateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-3", {
      summary: "Test",
      end: "2026-02-21T09:30:00Z",
    });
    const data = parse(result);
    expect(data.error).toBe("start required");
  });

  it("returns error when end is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarCreateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-4", {
      summary: "Test",
      start: "2026-02-21T09:00:00Z",
    });
    const data = parse(result);
    expect(data.error).toBe("end required");
  });
});

// ---------------------------------------------------------------------------
// calendar_update_event
// ---------------------------------------------------------------------------

describe("calendar_update_event", () => {
  it("patches only provided fields", async () => {
    const cal = mockCalendar();
    (cal.events.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ...sampleEvent, summary: "Updated standup" },
    });

    const tool = calendarUpdateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", {
      eventId: "evt-1",
      summary: "Updated standup",
    });

    const data = parse(result);
    expect(data.summary).toBe("Updated standup");

    const args = (cal.events.patch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.calendarId).toBe("primary");
    expect(args.eventId).toBe("evt-1");
    expect(args.requestBody).toEqual({ summary: "Updated standup" });
  });

  it("returns error when eventId is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarUpdateEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-2", { summary: "something" });
    const data = parse(result);
    expect(data.error).toBe("eventId required");
  });
});

// ---------------------------------------------------------------------------
// calendar_delete_event
// ---------------------------------------------------------------------------

describe("calendar_delete_event", () => {
  it("deletes an event and returns confirmation", async () => {
    const cal = mockCalendar();
    (cal.events.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const tool = calendarDeleteEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", {
      eventId: "evt-1",
      sendUpdates: "none",
    });

    const data = parse(result);
    expect(data).toEqual({ deleted: true, eventId: "evt-1" });

    const args = (cal.events.delete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.calendarId).toBe("primary");
    expect(args.eventId).toBe("evt-1");
    expect(args.sendUpdates).toBe("none");
  });

  it("returns error when eventId is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarDeleteEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-2", {});
    const data = parse(result);
    expect(data.error).toBe("eventId required");
  });

  it("returns error on API failure", async () => {
    const cal = mockCalendar();
    (cal.events.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Forbidden"),
    );

    const tool = calendarDeleteEventTool(() => cal, ["default"]);
    const result = await tool.execute("call-3", { eventId: "evt-1" });
    const data = parse(result);
    expect(data.error).toBe("Forbidden");
  });
});

// ---------------------------------------------------------------------------
// calendar_freebusy
// ---------------------------------------------------------------------------

describe("calendar_freebusy", () => {
  it("queries availability for multiple users", async () => {
    const cal = mockCalendar();
    (cal.freebusy.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        calendars: {
          "alice@example.com": {
            busy: [
              { start: "2026-02-21T09:00:00Z", end: "2026-02-21T10:00:00Z" },
            ],
            errors: [],
          },
          "bob@example.com": {
            busy: [],
            errors: [],
          },
        },
      },
    });

    const tool = calendarFreebusyTool(() => cal, ["default"]);
    const result = await tool.execute("call-1", {
      timeMin: "2026-02-21T00:00:00Z",
      timeMax: "2026-02-22T00:00:00Z",
      emails: ["alice@example.com", "bob@example.com"],
    });

    const data = parse(result);
    expect(data.timeMin).toBe("2026-02-21T00:00:00Z");
    expect(data.timeMax).toBe("2026-02-22T00:00:00Z");
    expect(data.availability).toHaveLength(2);
    expect(data.availability[0].email).toBe("alice@example.com");
    expect(data.availability[0].busy).toEqual([
      { start: "2026-02-21T09:00:00Z", end: "2026-02-21T10:00:00Z" },
    ]);
    expect(data.availability[1].email).toBe("bob@example.com");
    expect(data.availability[1].busy).toEqual([]);

    const args = (cal.freebusy.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.requestBody.timeMin).toBe("2026-02-21T00:00:00Z");
    expect(args.requestBody.timeMax).toBe("2026-02-22T00:00:00Z");
    expect(args.requestBody.items).toEqual([
      { id: "alice@example.com" },
      { id: "bob@example.com" },
    ]);
  });

  it("returns error when timeMin is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarFreebusyTool(() => cal, ["default"]);
    const result = await tool.execute("call-2", {
      timeMax: "2026-02-22T00:00:00Z",
      emails: ["alice@example.com"],
    });
    const data = parse(result);
    expect(data.error).toBe("timeMin required");
  });

  it("returns error when timeMax is missing", async () => {
    const cal = mockCalendar();
    const tool = calendarFreebusyTool(() => cal, ["default"]);
    const result = await tool.execute("call-3", {
      timeMin: "2026-02-21T00:00:00Z",
      emails: ["alice@example.com"],
    });
    const data = parse(result);
    expect(data.error).toBe("timeMax required");
  });

  it("returns error when emails is empty", async () => {
    const cal = mockCalendar();
    const tool = calendarFreebusyTool(() => cal, ["default"]);
    const result = await tool.execute("call-4", {
      timeMin: "2026-02-21T00:00:00Z",
      timeMax: "2026-02-22T00:00:00Z",
      emails: [],
    });
    const data = parse(result);
    expect(data.error).toBe("emails required");
  });
});
