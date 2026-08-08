import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import { MessageRequestSchema } from "@/lib/validation/schemas";
import { processTurn } from "@/lib/interview/turnService";
import * as repo from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** §24 — one interview turn. Guarded by a per-session processing lock. */
export async function POST(request: Request): Promise<NextResponse> {
  let sessionId: string | null = null;
  let locked = false;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = MessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "入力内容を確認してください。");
    }
    sessionId = parsed.data.session_id;

    const session = await repo.getSession(sessionId);
    if (!session) return apiError("SESSION_NOT_FOUND");
    if (session.status !== "active") return apiError("SESSION_CLOSED");

    locked = await repo.acquireSessionLock(sessionId);
    if (!locked) return apiError("SESSION_BUSY");

    const outcome = await processTurn(sessionId, parsed.data.message);

    return NextResponse.json({
      reply: outcome.reply,
      turn: outcome.turn,
      progress: outcome.progress,
      is_complete: outcome.isComplete,
      result_url: outcome.resultUrl,
      aborted: outcome.aborted,
      extraction_degraded: outcome.extractionDegraded,
    });
  } catch (error) {
    return toApiError(error, "interview/message");
  } finally {
    if (sessionId && locked) {
      await repo.releaseSessionLock(sessionId).catch((e) => {
        console.error("[api] failed to release session lock:", e);
      });
    }
  }
}
