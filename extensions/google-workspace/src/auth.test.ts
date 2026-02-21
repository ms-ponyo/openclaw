import { describe, expect, it } from "vitest";
import { resolveScopes } from "./auth.js";

describe("resolveScopes", () => {
  it("returns gmail scopes for the 'gmail' skill", () => {
    const scopes = resolveScopes(["gmail"]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
  });

  it("returns calendar scopes for the 'google-calendar' skill", () => {
    const scopes = resolveScopes(["google-calendar"]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("returns both gmail and calendar scopes for both skills", () => {
    const scopes = resolveScopes(["gmail", "google-calendar"]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("deduplicates scopes when skills are listed more than once", () => {
    const scopes = resolveScopes(["gmail", "gmail"]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
  });

  it("returns an empty array for unknown skills", () => {
    const scopes = resolveScopes(["unknown-skill", "another"]);
    expect(scopes).toEqual([]);
  });
});
