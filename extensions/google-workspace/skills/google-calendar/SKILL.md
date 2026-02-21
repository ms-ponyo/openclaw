---
name: google-calendar
description: Read, create, update, and manage Google Calendar events.
metadata:
  {
    "openclaw":
      {
        "emoji": "📅",
        "requires": { "config": ["google-workspace.serviceAccountKey", "google-workspace.delegateEmail"] },
      },
  }
---

# Google Calendar

You have access to Google Calendar tools for managing events and checking availability.

## Available Tools

- **calendar_list_events** — List upcoming events (defaults to next 7 days)
- **calendar_get_event** — Get full details of a specific event
- **calendar_create_event** — Create a new event with optional attendees
- **calendar_update_event** — Update an existing event (partial update)
- **calendar_delete_event** — Delete/cancel an event
- **calendar_freebusy** — Check availability for scheduling

## Time Format

All times use ISO 8601 with timezone offset: `2026-02-22T10:00:00-08:00`

For all-day events, use date only: `2026-02-22`

## Common Workflows

**Check today's schedule:**
Use `calendar_list_events` with timeMin set to start of today and timeMax to end of today.

**Schedule a meeting:**
1. `calendar_freebusy` to check attendee availability
2. `calendar_create_event` with the available time slot and attendee emails

**Reschedule a meeting:**
1. `calendar_list_events` to find the event
2. `calendar_update_event` with new start/end times

**Cancel a meeting:**
Use `calendar_delete_event` with sendUpdates: "all" to notify attendees.

## Calendar IDs

- `primary` — the delegated user's main calendar (default)
- Specific calendar IDs can be found in Google Calendar settings
