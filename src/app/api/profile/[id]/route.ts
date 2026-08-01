import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api/errors";
import { buildProfile } from "@/lib/interview/profileService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §25 — the session id is a nanoid(21) and doubles as the access token for the
 * MVP: only someone holding the id can read the profile, and ids cannot be
 * enumerated.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!id || id.length > 64) return apiError("INVALID_INPUT");

    const profile = await buildProfile(id);
    if (!profile) return apiError("SESSION_NOT_FOUND");

    return NextResponse.json(profile);
  } catch (error) {
    return toApiError(error, "profile/[id]");
  }
}
