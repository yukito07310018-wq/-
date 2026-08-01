import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import { pickOpeningQuestion } from "@/lib/engine/fallbackQuestions";
import * as repo from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §24 — starts a session.
 * Turn 0 has no evidence, so QValue selection would be meaningless; the opening
 * question comes from the pre-authored broad set instead.
 */
export async function POST(): Promise<NextResponse> {
  try {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      return apiError(
        "AI_UNAVAILABLE",
        "サーバー側で AI の設定が完了していません。管理者にお問い合わせください。"
      );
    }

    const sessionId = await repo.createSession();
    const opening = pickOpeningQuestion();

    await repo.saveConversationTurn(sessionId, 0, "assistant", opening.text);
    await repo.saveAskedQuestion(sessionId, {
      turn: 0,
      text: opening.text,
      target_elements: opening.target_elements,
      probe_kind: opening.probe_kind,
      q_value: 0,
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
