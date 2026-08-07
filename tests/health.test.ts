import { describe, expect, it } from "vitest";
import { redact } from "@/lib/api/health";

/**
 * §3 — /api/health is unauthenticated, so anything it echoes from an upstream
 * error is public. A probe added to explain outages must not leak a key.
 */

describe("redact", () => {
  it("removes an Anthropic key from error text", () => {
    const secret = "sk-ant-api03-AbCdEf123456";
    const out = redact(`401 {"error":{"message":"invalid x-api-key ${secret}"}}`);
    expect(out).not.toContain(secret);
  });

  it("removes a bare key not preceded by a header name", () => {
    const secret = "sk-ant-api03-ZzYyXx987654";
    expect(redact(`request failed with ${secret} rejected`)).not.toContain(secret);
  });

  it("removes a bearer token", () => {
    expect(redact("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer ***");
  });

  it("removes an x-api-key header value", () => {
    expect(redact('x-api-key: "abcdef123456"')).not.toContain("abcdef123456");
  });

  it("leaves ordinary text alone", () => {
    const text = "モデル \"claude-sonnet-4-5\" に接続できませんでした。";
    expect(redact(text)).toBe(text);
  });
});
