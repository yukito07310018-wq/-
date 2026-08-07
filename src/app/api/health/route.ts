import { NextResponse } from "next/server";
import { buildHealthReport } from "@/lib/api/health";
import { toApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * §3 — configuration and connectivity probe.
 *
 * Open this in a browser to find out whether an interview can produce evidence
 * at all. `?probe=0` skips the upstream model call and reports configuration
 * only. Responses never contain the API key (see redact() in lib/api/health).
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const probeModel = new URL(request.url).searchParams.get("probe") !== "0";
    const report = await buildHealthReport(probeModel);
    return NextResponse.json(report, {
      status: report.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return toApiError(error, "health");
  }
}
