import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { gmail_v1 } from "@googleapis/gmail";
import {
  gmailSearchTool,
  gmailReadTool,
  gmailSendTool,
  gmailReplyTool,
  gmailDraftCreateTool,
  gmailDraftSendTool,
  gmailModifyTool,
  gmailAttachmentGetTool,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Mock Gmail client
// ---------------------------------------------------------------------------

function mockGmail() {
  return {
    users: {
      messages: {
        list: vi.fn(),
        get: vi.fn(),
        send: vi.fn(),
        modify: vi.fn(),
        attachments: {
          get: vi.fn(),
        },
      },
      drafts: {
        create: vi.fn(),
        send: vi.fn(),
      },
    },
  } as unknown as gmail_v1.Gmail & {
    users: {
      messages: {
        list: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        modify: ReturnType<typeof vi.fn>;
        attachments: {
          get: ReturnType<typeof vi.fn>;
        };
      };
      drafts: {
        create: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
      };
    };
  };
}

// Helper to build a base64url-encoded string
function toBase64Url(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeMessagePayload(opts: {
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  cc?: string;
  bodyText?: string;
  messageId?: string;
}) {
  const headers: gmail_v1.Schema$MessagePartHeader[] = [
    { name: "From", value: opts.from ?? "alice@example.com" },
    { name: "To", value: opts.to ?? "bob@example.com" },
    { name: "Subject", value: opts.subject ?? "Test Subject" },
    { name: "Date", value: opts.date ?? "Mon, 1 Jan 2024 00:00:00 +0000" },
  ];
  if (opts.cc) headers.push({ name: "Cc", value: opts.cc });
  if (opts.messageId) headers.push({ name: "Message-ID", value: opts.messageId });

  return {
    headers,
    mimeType: "text/plain",
    body: {
      data: opts.bodyText ? toBase64Url(opts.bodyText) : toBase64Url("Hello, World!"),
      size: (opts.bodyText ?? "Hello, World!").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gmail_search", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("searches and returns message summaries", async () => {
    gmail.users.messages.list.mockResolvedValue({
      data: {
        messages: [{ id: "msg1", threadId: "t1" }],
        resultSizeEstimate: 1,
      },
    });
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg1",
        threadId: "t1",
        snippet: "Hello there",
        labelIds: ["INBOX"],
        payload: makeMessagePayload({}),
      },
    });

    const tool = gmailSearchTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", { query: "from:alice" });

    expect(gmail.users.messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "me", q: "from:alice" }),
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].from).toBe("alice@example.com");
    expect(parsed.messages[0].subject).toBe("Test Subject");
    expect(parsed.total).toBe(1);
    expect(parsed.query).toBe("from:alice");
  });

  it("handles empty results", async () => {
    gmail.users.messages.list.mockResolvedValue({
      data: {
        messages: undefined,
        resultSizeEstimate: 0,
      },
    });

    const tool = gmailSearchTool(() => gmail, ["default"]);
    const result = await tool.execute("call2", { query: "nonexistent" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.total).toBe(0);
  });

  it("passes labelIds filter", async () => {
    gmail.users.messages.list.mockResolvedValue({
      data: { messages: [], resultSizeEstimate: 0 },
    });

    const tool = gmailSearchTool(() => gmail, ["default"]);
    await tool.execute("call3", {
      query: "test",
      labelIds: ["INBOX", "UNREAD"],
    });

    expect(gmail.users.messages.list).toHaveBeenCalledWith(
      expect.objectContaining({
        labelIds: ["INBOX", "UNREAD"],
      }),
    );
  });

  it("clamps maxResults to valid range", async () => {
    gmail.users.messages.list.mockResolvedValue({
      data: { messages: [], resultSizeEstimate: 0 },
    });

    const tool = gmailSearchTool(() => gmail, ["default"]);
    await tool.execute("call4", { query: "test", maxResults: 100 });

    expect(gmail.users.messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 50 }),
    );
  });

  it("returns error on API failure", async () => {
    gmail.users.messages.list.mockRejectedValue(new Error("API quota exceeded"));

    const tool = gmailSearchTool(() => gmail, ["default"]);
    const result = await tool.execute("call5", { query: "test" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("API quota exceeded");
  });
});

describe("gmail_read", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("reads full message content and decodes body", async () => {
    const bodyText = "This is the email body.";
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg1",
        threadId: "t1",
        snippet: "This is the email",
        labelIds: ["INBOX"],
        payload: makeMessagePayload({ bodyText }),
      },
    });

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", { messageId: "msg1" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("msg1");
    expect(parsed.body).toBe(bodyText);
    expect(parsed.from).toBe("alice@example.com");
    expect(parsed.subject).toBe("Test Subject");
  });

  it("reads multipart message body", async () => {
    const bodyText = "Plain text body";
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg2",
        threadId: "t2",
        snippet: "Plain text",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "Multipart" },
            { name: "Date", value: "Mon, 1 Jan 2024 00:00:00 +0000" },
          ],
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: toBase64Url(bodyText), size: bodyText.length },
            },
            {
              mimeType: "text/html",
              body: { data: toBase64Url("<b>HTML</b>"), size: 11 },
            },
          ],
        },
      },
    });

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call2", { messageId: "msg2" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.body).toBe(bodyText);
  });

  it("extracts attachments metadata", async () => {
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg3",
        threadId: "t3",
        snippet: "With attachment",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "Attached" },
            { name: "Date", value: "Mon, 1 Jan 2024 00:00:00 +0000" },
          ],
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: toBase64Url("body"), size: 4 },
            },
            {
              filename: "report.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "att1", size: 1024 },
            },
          ],
        },
      },
    });

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call3", { messageId: "msg3" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toEqual({
      attachmentId: "att1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });
  });

  it("returns metadata format when requested", async () => {
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg4",
        threadId: "t4",
        snippet: "Metadata only",
        labelIds: ["INBOX"],
        payload: makeMessagePayload({}),
      },
    });

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call4", {
      messageId: "msg4",
      format: "metadata",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("msg4");
    // Metadata format should not have body
    expect(parsed.body).toBeUndefined();
  });

  it("returns minimal format when requested", async () => {
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "msg5",
        threadId: "t5",
        snippet: "Minimal",
        labelIds: ["INBOX"],
      },
    });

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call5", {
      messageId: "msg5",
      format: "minimal",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("msg5");
    expect(parsed.snippet).toBe("Minimal");
    expect(parsed.body).toBeUndefined();
  });

  it("returns error on API failure", async () => {
    gmail.users.messages.get.mockRejectedValue(new Error("Not found"));

    const tool = gmailReadTool(() => gmail, ["default"]);
    const result = await tool.execute("call6", { messageId: "bad-id" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not found");
  });
});

describe("gmail_send", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("sends email and returns confirmation", async () => {
    gmail.users.messages.send.mockResolvedValue({
      data: { id: "sent1", threadId: "t-sent1" },
    });

    const tool = gmailSendTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", {
      to: "bob@example.com",
      subject: "Hello",
      body: "Hi Bob!",
    });

    expect(gmail.users.messages.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        requestBody: expect.objectContaining({
          raw: expect.any(String),
        }),
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("sent1");
    expect(parsed.sent).toBe(true);
  });

  it("includes cc and bcc in raw email", async () => {
    gmail.users.messages.send.mockResolvedValue({
      data: { id: "sent2", threadId: "t-sent2" },
    });

    const tool = gmailSendTool(() => gmail, ["default"]);
    await tool.execute("call2", {
      to: "bob@example.com",
      subject: "Hello",
      body: "Hi!",
      cc: "carol@example.com",
      bcc: "dave@example.com",
    });

    const call = gmail.users.messages.send.mock.calls[0][0];
    const rawDecoded = Buffer.from(call.requestBody.raw, "base64").toString("utf-8");
    expect(rawDecoded).toContain("Cc: carol@example.com");
    expect(rawDecoded).toContain("Bcc: dave@example.com");
  });

  it("returns error on send failure", async () => {
    gmail.users.messages.send.mockRejectedValue(new Error("Send failed"));

    const tool = gmailSendTool(() => gmail, ["default"]);
    const result = await tool.execute("call3", {
      to: "bad@example.com",
      subject: "Fail",
      body: "Oops",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Send failed");
  });
});

describe("gmail_reply", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("replies to a message with correct headers", async () => {
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "orig1",
        threadId: "t-orig1",
        payload: {
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Subject", value: "Original" },
            { name: "Message-ID", value: "<orig1@example.com>" },
          ],
        },
      },
    });
    gmail.users.messages.send.mockResolvedValue({
      data: { id: "reply1", threadId: "t-orig1" },
    });

    const tool = gmailReplyTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", {
      threadId: "t-orig1",
      messageId: "orig1",
      body: "Thanks!",
    });

    const sendCall = gmail.users.messages.send.mock.calls[0][0];
    expect(sendCall.requestBody.threadId).toBe("t-orig1");
    const rawDecoded = Buffer.from(sendCall.requestBody.raw, "base64").toString("utf-8");
    expect(rawDecoded).toContain("In-Reply-To: <orig1@example.com>");
    expect(rawDecoded).toContain("References: <orig1@example.com>");
    expect(rawDecoded).toContain("Re: Original");
    // Reply goes to the original sender
    expect(rawDecoded).toContain("To: alice@example.com");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sent).toBe(true);
  });

  it("reply-all includes To and Cc from original", async () => {
    gmail.users.messages.get.mockResolvedValue({
      data: {
        id: "orig2",
        threadId: "t-orig2",
        payload: {
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "bob@example.com" },
            { name: "Cc", value: "carol@example.com" },
            { name: "Subject", value: "Re: Thread" },
            { name: "Message-ID", value: "<orig2@example.com>" },
          ],
        },
      },
    });
    gmail.users.messages.send.mockResolvedValue({
      data: { id: "reply2", threadId: "t-orig2" },
    });

    const tool = gmailReplyTool(() => gmail, ["default"]);
    await tool.execute("call2", {
      threadId: "t-orig2",
      messageId: "orig2",
      body: "Reply all!",
      replyAll: true,
    });

    const sendCall = gmail.users.messages.send.mock.calls[0][0];
    const rawDecoded = Buffer.from(sendCall.requestBody.raw, "base64").toString("utf-8");
    // Reply-all: To includes original From and To
    expect(rawDecoded).toContain("alice@example.com");
    expect(rawDecoded).toContain("bob@example.com");
    expect(rawDecoded).toContain("Cc: carol@example.com");
    // Subject already has Re: prefix, should not duplicate
    expect(rawDecoded).toContain("Subject: Re: Thread");
    expect(rawDecoded).not.toContain("Re: Re:");
  });
});

describe("gmail_draft_create", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("creates a draft", async () => {
    gmail.users.drafts.create.mockResolvedValue({
      data: { id: "draft1", message: { id: "draft-msg1" } },
    });

    const tool = gmailDraftCreateTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", {
      to: "bob@example.com",
      subject: "Draft subject",
      body: "Draft body",
    });

    expect(gmail.users.drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        requestBody: expect.objectContaining({
          message: expect.objectContaining({
            raw: expect.any(String),
          }),
        }),
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("draft1");
    expect(parsed.created).toBe(true);
  });
});

describe("gmail_draft_send", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("sends an existing draft", async () => {
    gmail.users.drafts.send.mockResolvedValue({
      data: { id: "draft1", message: { id: "sent-msg1" } },
    });

    const tool = gmailDraftSendTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", { draftId: "draft1" });

    expect(gmail.users.drafts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        requestBody: { id: "draft1" },
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sent).toBe(true);
  });
});

describe("gmail_modify", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("modifies labels on a message", async () => {
    gmail.users.messages.modify.mockResolvedValue({
      data: {
        id: "msg1",
        threadId: "t1",
        labelIds: ["INBOX", "STARRED"],
      },
    });

    const tool = gmailModifyTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", {
      messageId: "msg1",
      addLabels: ["STARRED"],
      removeLabels: ["UNREAD"],
    });

    expect(gmail.users.messages.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        id: "msg1",
        requestBody: {
          addLabelIds: ["STARRED"],
          removeLabelIds: ["UNREAD"],
        },
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.modified).toBe(true);
    expect(parsed.labelIds).toContain("STARRED");
  });

  it("handles add-only label modification", async () => {
    gmail.users.messages.modify.mockResolvedValue({
      data: { id: "msg2", threadId: "t2", labelIds: ["INBOX", "IMPORTANT"] },
    });

    const tool = gmailModifyTool(() => gmail, ["default"]);
    const result = await tool.execute("call2", {
      messageId: "msg2",
      addLabels: ["IMPORTANT"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.modified).toBe(true);
  });

  it("returns error on failure", async () => {
    gmail.users.messages.modify.mockRejectedValue(new Error("Invalid label"));

    const tool = gmailModifyTool(() => gmail, ["default"]);
    const result = await tool.execute("call3", {
      messageId: "bad",
      addLabels: ["NONEXISTENT"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Invalid label");
  });
});

describe("gmail_attachment_get", () => {
  let gmail: ReturnType<typeof mockGmail>;

  beforeEach(() => {
    gmail = mockGmail();
  });

  it("saves attachment to workspace and returns path", async () => {
    const fileContent = "PDF file content";
    const base64urlData = Buffer.from(fileContent)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    gmail.users.messages.attachments.get.mockResolvedValue({
      data: { data: base64urlData, size: fileContent.length },
    });

    const workspaceDir = path.join(os.tmpdir(), `oc-test-${Date.now()}`);
    const tool = gmailAttachmentGetTool(() => gmail, ["default"], workspaceDir);
    const result = await tool.execute("call1", {
      messageId: "msg1",
      attachmentId: "att1",
      filename: "report.pdf",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toContain("report.pdf");
    expect(parsed.filename).toBe("report.pdf");
    expect(parsed.size).toBe(fileContent.length);
    expect(parsed.data).toBeUndefined();

    // Verify file was written
    const written = await fs.readFile(parsed.path);
    expect(written.toString()).toBe(fileContent);

    // Cleanup
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("falls back to base64 when no workspace configured", async () => {
    const attachmentData = toBase64Url("file content");
    gmail.users.messages.attachments.get.mockResolvedValue({
      data: { data: attachmentData, size: 12 },
    });

    const tool = gmailAttachmentGetTool(() => gmail, ["default"]);
    const result = await tool.execute("call1", {
      messageId: "msg1",
      attachmentId: "att1",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toBe(attachmentData);
    expect(parsed.size).toBe(12);
  });
});
