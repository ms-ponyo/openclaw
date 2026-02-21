import { Type } from "@sinclair/typebox";
import type { gmail_v1 } from "@googleapis/gmail";
import { json, errorResult, withRetry } from "../shared.js";
import type { GmailMessageSummary, GmailMessageFull } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const header = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  return header?.value ?? "";
}

function decodeBase64Url(data: string): string {
  // Gmail uses base64url encoding (RFC 4648 section 5).
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // Simple message with body data directly on payload
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart message: search parts recursively for text/plain or text/html
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Recurse into nested multipart parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): GmailMessageFull["attachments"] {
  const attachments: NonNullable<GmailMessageFull["attachments"]> = [];
  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
      });
    }
    // Recurse into nested parts
    if (part.parts) {
      const nested = extractAttachments(part);
      if (nested) attachments.push(...nested);
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

function parseMessage(msg: gmail_v1.Schema$Message): GmailMessageFull {
  const headers = msg.payload?.headers;
  const attachments = extractAttachments(msg.payload);
  const cc = extractHeader(headers, "Cc");
  const bcc = extractHeader(headers, "Bcc");

  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    snippet: msg.snippet ?? "",
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    date: extractHeader(headers, "Date"),
    labelIds: msg.labelIds ?? [],
    body: extractBody(msg.payload),
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

function summarizeMessage(msg: gmail_v1.Schema$Message): GmailMessageSummary {
  const headers = msg.payload?.headers;
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    snippet: msg.snippet ?? "",
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    date: extractHeader(headers, "Date"),
    labelIds: msg.labelIds ?? [],
  };
}

function buildRawEmail(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);

  lines.push("", params.body);

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function gmailSearchTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_search",
    label: "Gmail Search",
    description:
      "Search Gmail messages by query. Returns message summaries including subject, from, to, date, and snippet.",
    parameters: Type.Object({
      query: Type.String({ description: "Gmail search query (same syntax as Gmail search box)." }),
      maxResults: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (1-50, default 10).",
          minimum: 1,
          maximum: 50,
        }),
      ),
      labelIds: Type.Optional(
        Type.Array(Type.String(), {
          description: "Only return messages with all of these label IDs.",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const query = params.query as string;
        const maxResults = Math.min(
          Math.max((params.maxResults as number) ?? 10, 1),
          50,
        );
        const labelIds = params.labelIds as string[] | undefined;

        const listRes = await withRetry(() =>
          gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults,
            ...(labelIds ? { labelIds } : {}),
          }),
        );

        const messageRefs = listRes.data.messages ?? [];
        const total = listRes.data.resultSizeEstimate ?? 0;

        if (messageRefs.length === 0) {
          return json({ messages: [], total: 0, query });
        }

        // Fetch metadata for each message
        const messages: GmailMessageSummary[] = await Promise.all(
          messageRefs.map(async (ref) => {
            const msg = await withRetry(() =>
              gmail.users.messages.get({
                userId: "me",
                id: ref.id!,
                format: "metadata",
                metadataHeaders: ["From", "To", "Subject", "Date"],
              }),
            );
            return summarizeMessage(msg.data);
          }),
        );

        return json({ messages, total, query });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailReadTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_read",
    label: "Gmail Read",
    description:
      "Read a specific Gmail message by ID. Returns full message content including body, headers, and attachment metadata.",
    parameters: Type.Object({
      messageId: Type.String({ description: "The Gmail message ID to read." }),
      format: Type.Optional(
        Type.Unsafe<"full" | "metadata" | "minimal">({
          type: "string",
          enum: ["full", "metadata", "minimal"],
          description: "Response format (default: full).",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const messageId = params.messageId as string;
        const format = (params.format as string) ?? "full";

        const res = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format,
          }),
        );

        if (format === "full") {
          return json(parseMessage(res.data));
        }
        if (format === "metadata") {
          return json(summarizeMessage(res.data));
        }
        // minimal
        return json({
          id: res.data.id,
          threadId: res.data.threadId,
          snippet: res.data.snippet,
          labelIds: res.data.labelIds ?? [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailSendTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_send",
    label: "Gmail Send",
    description: "Send a new email message via Gmail.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient email address." }),
      subject: Type.String({ description: "Email subject line." }),
      body: Type.String({ description: "Email body text." }),
      cc: Type.Optional(Type.String({ description: "CC recipients." })),
      bcc: Type.Optional(Type.String({ description: "BCC recipients." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const raw = buildRawEmail({
          to: params.to as string,
          subject: params.subject as string,
          body: params.body as string,
          cc: params.cc as string | undefined,
          bcc: params.bcc as string | undefined,
        });

        const res = await withRetry(() =>
          gmail.users.messages.send({
            userId: "me",
            requestBody: { raw },
          }),
        );

        return json({
          id: res.data.id,
          threadId: res.data.threadId,
          sent: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailReplyTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_reply",
    label: "Gmail Reply",
    description:
      "Reply to an existing email message in the same thread. Automatically sets In-Reply-To and References headers.",
    parameters: Type.Object({
      threadId: Type.String({ description: "The thread ID to reply in." }),
      messageId: Type.String({ description: "The message ID to reply to." }),
      body: Type.String({ description: "Reply body text." }),
      replyAll: Type.Optional(
        Type.Boolean({ description: "Whether to reply to all recipients (default: false)." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const threadId = params.threadId as string;
        const messageId = params.messageId as string;
        const body = params.body as string;
        const replyAll = (params.replyAll as boolean) ?? false;

        // Fetch original message headers
        const original = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "metadata",
            metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID"],
          }),
        );

        const headers = original.data.payload?.headers;
        const originalFrom = extractHeader(headers, "From");
        const originalTo = extractHeader(headers, "To");
        const originalCc = extractHeader(headers, "Cc");
        const originalSubject = extractHeader(headers, "Subject");
        const originalMessageId = extractHeader(headers, "Message-ID");

        // Build reply recipients
        const to = replyAll
          ? [originalFrom, originalTo].filter(Boolean).join(", ")
          : originalFrom;
        const cc = replyAll && originalCc ? originalCc : undefined;

        // Build subject with Re: prefix
        const subject = originalSubject.startsWith("Re:")
          ? originalSubject
          : `Re: ${originalSubject}`;

        const raw = buildRawEmail({
          to,
          subject,
          body,
          cc,
          inReplyTo: originalMessageId,
          references: originalMessageId,
        });

        const res = await withRetry(() =>
          gmail.users.messages.send({
            userId: "me",
            requestBody: { raw, threadId },
          }),
        );

        return json({
          id: res.data.id,
          threadId: res.data.threadId,
          sent: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailDraftCreateTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_draft_create",
    label: "Gmail Draft Create",
    description: "Create a new email draft in Gmail.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient email address." }),
      subject: Type.String({ description: "Email subject line." }),
      body: Type.String({ description: "Email body text." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const raw = buildRawEmail({
          to: params.to as string,
          subject: params.subject as string,
          body: params.body as string,
        });

        const res = await withRetry(() =>
          gmail.users.drafts.create({
            userId: "me",
            requestBody: {
              message: { raw },
            },
          }),
        );

        return json({
          id: res.data.id,
          messageId: res.data.message?.id,
          created: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailDraftSendTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_draft_send",
    label: "Gmail Draft Send",
    description: "Send an existing Gmail draft by its draft ID.",
    parameters: Type.Object({
      draftId: Type.String({ description: "The draft ID to send." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const draftId = params.draftId as string;

        const res = await withRetry(() =>
          gmail.users.drafts.send({
            userId: "me",
            requestBody: { id: draftId },
          }),
        );

        return json({
          id: res.data.id,
          messageId: res.data.message?.id,
          sent: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailModifyTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_modify",
    label: "Gmail Modify",
    description:
      "Modify labels on a Gmail message. Add or remove labels such as INBOX, UNREAD, STARRED, etc.",
    parameters: Type.Object({
      messageId: Type.String({ description: "The message ID to modify." }),
      addLabels: Type.Optional(
        Type.Array(Type.String(), { description: "Label IDs to add." }),
      ),
      removeLabels: Type.Optional(
        Type.Array(Type.String(), { description: "Label IDs to remove." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const messageId = params.messageId as string;
        const addLabelIds = params.addLabels as string[] | undefined;
        const removeLabelIds = params.removeLabels as string[] | undefined;

        const res = await withRetry(() =>
          gmail.users.messages.modify({
            userId: "me",
            id: messageId,
            requestBody: {
              ...(addLabelIds ? { addLabelIds } : {}),
              ...(removeLabelIds ? { removeLabelIds } : {}),
            },
          }),
        );

        return json({
          id: res.data.id,
          threadId: res.data.threadId,
          labelIds: res.data.labelIds ?? [],
          modified: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function gmailAttachmentGetTool(gmail: gmail_v1.Gmail) {
  return {
    name: "gmail_attachment_get",
    label: "Gmail Attachment Get",
    description: "Download an attachment from a Gmail message. Returns base64url-encoded data.",
    parameters: Type.Object({
      messageId: Type.String({ description: "The message ID containing the attachment." }),
      attachmentId: Type.String({ description: "The attachment ID to retrieve." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const messageId = params.messageId as string;
        const attachmentId = params.attachmentId as string;

        const res = await withRetry(() =>
          gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: attachmentId,
          }),
        );

        return json({
          data: res.data.data,
          size: res.data.size,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}
