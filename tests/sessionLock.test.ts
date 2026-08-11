import { describe, expect, it } from "vitest";
import { SESSION_LOCK_TTL_MS } from "@/lib/db/repository";
import { TURN_AI_BUDGET_MS } from "@/lib/interview/turnService";
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

/**
 * The turn's own model-call budget has to run out before the platform kills the
 * request, otherwise the turn ends as a transport error the client cannot read
 * and the session lock is left held until it expires.
 */
describe("turn AI budget", () => {
  it("expires before the platform stops the request", () => {
    expect(TURN_AI_BUDGET_MS).toBeLessThan(maxDuration * 1000);
  });

  it("leaves room for the turn's database work after the last model call", () => {
    expect(maxDuration * 1000 - TURN_AI_BUDGET_MS).toBeGreaterThanOrEqual(30_000);
  });
});
