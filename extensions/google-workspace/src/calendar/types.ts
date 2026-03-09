export type CalendarEventSummary = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  status: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  htmlLink?: string;
  recurrence?: string[];
  recurringEventId?: string;
};
