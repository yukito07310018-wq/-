import { NextResponse } from "next/server";
import type { ApiErrorCode } from "../types/diagnosis";

/**
 * §24/§39 — uniform error envelope.
 * Internal exception text and stack traces never reach the client; they are
 * logged server-side and replaced with a Japanese message the user can act on.
 */

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  SESSION_NOT_FOUND: 404,
  SESSION_BUSY: 409,
  SESSION_CLOSED: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  INVALID_INPUT: "入力内容を確認してください。",
  SESSION_NOT_FOUND: "この診断セッションは見つかりませんでした。",
  SESSION_BUSY: "前の回答を処理中です。少し待ってから送信してください。",
  SESSION_CLOSED: "この診断はすでに終了しています。",
  RATE_LIMITED: "アクセスが集中しています。少し待ってからお試しください。",
  AI_UNAVAILABLE: "AI との通信に失敗しました。少し待ってからお試しください。",
  INTERNAL: "処理中に問題が発生しました。時間をおいてお試しください。",
};

export function apiError(code: ApiErrorCode, message?: string): NextResponse {
  return NextResponse.json(
    { error: { code, message: message ?? DEFAULT_MESSAGE[code] } },
    { status: STATUS_BY_CODE[code] }
  );
}

/** Maps a thrown value onto the error envelope, logging the original. */
export function toApiError(error: unknown, context: string): NextResponse {
  console.error(`[api] ${context}:`, error);

  const name = error instanceof Error ? error.name : "";
  if (name === "RateLimitedError") return apiError("RATE_LIMITED");
  if (name === "AiUnavailableError") return apiError("AI_UNAVAILABLE");
  if (name === "SessionNotFoundError") return apiError("SESSION_NOT_FOUND");
  return apiError("INTERNAL");
}
