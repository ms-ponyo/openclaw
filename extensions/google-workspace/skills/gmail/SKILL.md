---
name: gmail
description: Read, search, send, and manage Gmail messages.
metadata:
  {
    "openclaw":
      {
        "emoji": "📧",
        "requires": { "config": ["google-workspace.serviceAccountKey", "google-workspace.delegateEmail"] },
      },
  }
---

# Gmail

You have access to Gmail tools for reading, searching, sending, and managing email.

## Available Tools

- **gmail_search** — Search messages with Gmail query syntax
- **gmail_read** — Read full message content by ID
- **gmail_send** — Send a new email
- **gmail_reply** — Reply to an existing thread
- **gmail_draft_create** — Create a draft without sending
- **gmail_draft_send** — Send an existing draft
- **gmail_modify** — Add/remove labels (archive, mark read, star, etc.)
- **gmail_attachment_get** — Download an attachment

## Search Query Syntax

Gmail search supports operators like:
- `from:alice@example.com` — from specific sender
- `to:bob@example.com` — to specific recipient
- `subject:meeting` — subject contains word
- `is:unread` — unread messages only
- `is:starred` — starred messages
- `newer_than:1d` — from the last day
- `has:attachment` — has attachments
- `label:INBOX` — in specific label

Combine with spaces (AND) or `OR`: `from:alice subject:meeting OR subject:standup`

## Common Workflows

**Check for new unread emails:**
Use `gmail_search` with query `is:unread newer_than:1h`

**Read and archive:**
1. `gmail_read` to get full content
2. `gmail_modify` with removeLabels: ["INBOX", "UNREAD"] to archive and mark read

**Reply to a thread:**
1. `gmail_search` or `gmail_read` to find the message
2. `gmail_reply` with the threadId and messageId from the result
