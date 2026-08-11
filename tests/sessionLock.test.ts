import { describe, expect, it } from "vitest";
import { SESSION_LOCK_TTL_MS } from "@/lib/db/repository";
import { maxDuration } from "@/app/api/interview/message/route";

/**
 * The stale-lock takeover and the route's own time limit are two halves of one
 * decision, declared in different files. Raising `maxDuration` without raising
 * the TTL lets a healthy turn that is merely slow have its lock taken by a
 * concurrent request, so the same session gets processed twice at once. This
 * has already happened once; the assertion is here so it cannot happen quietly.
 */
describe("session lock TTL", () => {
  it("outlives the longest turn the route will allow", () => {
    expect(SESSION_LOCK_TTL_MS).toBeGreaterThan(maxDuration * 1000);
  });

  it("leaves at least a minute of headroom above it", () => {
    expect(SESSION_LOCK_TTL_MS - maxDuration * 1000).toBeGreaterThanOrEqual(60_000);
  });
});
