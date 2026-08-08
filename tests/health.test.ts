import { describe, expect, it } from "vitest";
import { diagnoseUpstreamStatus, redact } from "@/lib/api/health";

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

/**
 * A wrong key and a wrong model id fail identically downstream — zero evidence
 * on every turn. Naming which one is the entire value of the probe.
 */
describe("diagnoseUpstreamStatus", () => {
  it("blames the key on 401", () => {
    expect(diagnoseUpstreamStatus(401)).toContain("ANTHROPIC_API_KEY");
    expect(diagnoseUpstreamStatus(401)).not.toContain("ANTHROPIC_MODEL");
  });

  it("blames the model id on 404, not the key", () => {
    expect(diagnoseUpstreamStatus(404)).toContain("ANTHROPIC_MODEL");
    expect(diagnoseUpstreamStatus(404)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("blames permissions on 403", () => {
    expect(diagnoseUpstreamStatus(403)).toContain("権限");
  });

  it("says the configuration is fine on 429", () => {
    expect(diagnoseUpstreamStatus(429)).toContain("設定は正しく");
  });

  it("points upstream on 5xx", () => {
    expect(diagnoseUpstreamStatus(503)).toContain("相手側");
  });

  /** No status at all means the request never got a reply — a different fix. */
  it("returns null when there is no HTTP status", () => {
    expect(diagnoseUpstreamStatus(undefined)).toBeNull();
  });
});
