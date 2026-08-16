import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import { pickOpeningQuestion } from "@/lib/engine/fallbackQuestions";
import * as repo from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §24 — starts a session.
 *
 * The first question is the first of the four pre-authored openers: thin, broad,
 * and deliberately not about anything, so the subject of the interview is picked
 * by the person being interviewed rather than by us.
 */
export async function POST(): Promise<NextResponse> {
  try {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      return apiError(
        "AI_UNAVAILABLE",
        "サーバー側で AI の設定が完了していません。管理者にお問い合わせください。"
      );
    }

    const opening = pickOpeningQuestion();
    if (!opening) {
      return apiError("INTERNAL", "入口となる質問が設定されていません。");
    }

    const sessionId = await repo.createSession();

    await repo.saveConversationTurn(sessionId, 0, "assistant", opening.text);
    await repo.saveAskedQuestion(sessionId, {
      turn: 0,
      text: opening.text,
      target_elements: opening.target_elements,
      probe_kind: opening.probe_kind,
      mode: "opening",
    });

    return NextResponse.json({
      session_id: sessionId,
      first_question: opening.text,
      turn: 0,
      progress: 0,
    });
  } catch (error) {
    return toApiError(error, "interview/start");
  }
}
