import { describe, expect, it } from "vitest";
import { resolveScopes, resolveAuthConfig } from "./auth.js";

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

describe("resolveAuthConfig", () => {
  it("returns oauth2 config when clientId + clientSecret + refreshToken provided", () => {
    const config = resolveAuthConfig({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
    });
    expect(config).toEqual({
      mode: "oauth2",
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
    });
  });

  it("returns service-account config when serviceAccountKey + delegateEmail provided", () => {
    const config = resolveAuthConfig({
      serviceAccountKey: "/path/to/key.json",
      delegateEmail: "user@example.com",
    });
    expect(config).toEqual({
      mode: "service-account",
      serviceAccountKey: "/path/to/key.json",
      delegateEmail: "user@example.com",
    });
  });

  it("prefers oauth2 when both sets of fields are provided", () => {
    const config = resolveAuthConfig({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
      serviceAccountKey: "/key.json",
      delegateEmail: "user@example.com",
    });
    expect(config?.mode).toBe("oauth2");
  });

  it("returns null when no valid config provided", () => {
    expect(resolveAuthConfig({})).toBeNull();
    expect(resolveAuthConfig({ clientId: "id" })).toBeNull();
    expect(resolveAuthConfig({ serviceAccountKey: "/key.json" })).toBeNull();
  });
});
