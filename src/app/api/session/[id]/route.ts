import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import * as repo from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §25 — data deletion. Cascades to turns, element states, evidence, score
 * history, contradictions, questions and snapshots.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!id || id.length > 64) return apiError("INVALID_INPUT");

    const deleted = await repo.deleteSession(id);
    if (!deleted) return apiError("SESSION_NOT_FOUND");

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toApiError(error, "session/[id] DELETE");
  }
}
