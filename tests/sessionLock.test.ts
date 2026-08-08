import { describe, expect, it } from "vitest";
import { isLockStale, LOCK_STALE_MS } from "@/lib/db/repository";

/**
 * §24 — the per-session processing lock.
 *
 * The lock is released in a `finally`, which a serverless function killed at its
 * maxDuration never reaches. Before this had an age, that left `processing` set
 * with nothing to clear it: every later message on the session answered
 * SESSION_BUSY, and the interview could not be continued at all.
 *
 * The threshold has to sit above the route's maxDuration in both directions —
 * long enough that a live turn is never interrupted, short enough that a user
 * is not stranded.
 */

const now = new Date("2026-08-08T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("isLockStale", () => {
  it("treats an unheld lock as fresh", () => {
    expect(isLockStale(false, null, now)).toBe(false);
    expect(isLockStale(false, ago(LOCK_STALE_MS * 10), now)).toBe(false);
  });

  it("leaves a lock taken just now alone", () => {
    expect(isLockStale(true, now, now)).toBe(false);
  });

  /** A request still inside its own deadline must never lose its lock. */
  it("leaves a lock alone while a live request could still hold it", () => {
    expect(isLockStale(true, ago(LOCK_STALE_MS - 1000), now)).toBe(false);
  });

  it("reclaims a lock once no live request could own it", () => {
    expect(isLockStale(true, ago(LOCK_STALE_MS), now)).toBe(true);
    expect(isLockStale(true, ago(LOCK_STALE_MS * 5), now)).toBe(true);
  });

  /** Sessions locked before this column existed would otherwise never recover. */
  it("reclaims a held lock that has no timestamp", () => {
    expect(isLockStale(true, null, now)).toBe(true);
  });

  it("stays above the message route's 120s maxDuration", () => {
    expect(LOCK_STALE_MS).toBeGreaterThan(120_000);
  });
});
