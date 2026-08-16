import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import { FinishRequestSchema } from "@/lib/validation/schemas";
import { readSession } from "@/lib/interview/readingService";
import * as repo from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 「ここまでにする」 — the user ends the interview.
 *
 * One of the two ways a session can end (the other is the turn ceiling), and
 * the important one: both real sessions ended with the person simply leaving,
 * and with the reading running only at the end, a session nobody closes is a
 * session that produces nothing. The button is on screen from the first turn.
 *
 * The reading is run here rather than left to the result page so the wait
 * happens under the button the user just pressed. It is idempotent, so the page
 * finding it already done is the normal case.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = FinishRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "入力内容を確認してください。");
    }
    const sessionId = parsed.data.session_id;

    const session = await repo.getSession(sessionId);
    if (!session) return apiError("SESSION_NOT_FOUND");

    if (session.status === "active") {
      await repo.setSessionStatus(sessionId, "completed");
    }

    const outcome = await readSession(sessionId);

    return NextResponse.json({
      result_url: `/result/${sessionId}`,
      reading_status: outcome.status,
    });
  } catch (error) {
    return toApiError(error, "interview/finish");
  }
}
