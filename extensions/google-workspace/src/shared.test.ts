import { describe, it, expect, vi } from "vitest";
import { json, errorResult, isRateLimitError, withRetry } from "./shared.js";

describe("json", () => {
  it("wraps payload in tool result format", () => {
    const result = json({ foo: "bar" });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
    expect(result.details).toEqual({ foo: "bar" });
  });
});

describe("errorResult", () => {
  it("wraps Error instance", () => {
    const result = errorResult(new Error("boom"));
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "boom" });
  });

  it("wraps string", () => {
    const result = errorResult("oops");
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "oops" });
  });
});

describe("isRateLimitError", () => {
  it("returns true for 429", () => {
    expect(isRateLimitError({ code: 429 })).toBe(true);
  });

  it("returns false for other codes", () => {
    expect(isRateLimitError({ code: 500 })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isRateLimitError("error")).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns on success", async () => {
    const result = await withRetry(async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries on 429 and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error("rate limit"), { code: 429 });
      return "ok";
    }, 3);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws non-retryable errors immediately", async () => {
    await expect(
      withRetry(async () => { throw new Error("auth failed"); }, 3),
    ).rejects.toThrow("auth failed");
  });
});
