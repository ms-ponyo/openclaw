export type GmailMessageSummary = {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  labelIds: string[];
};

export type GmailMessageFull = GmailMessageSummary & {
  body: string;
  cc?: string;
  bcc?: string;
  attachments?: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
};
