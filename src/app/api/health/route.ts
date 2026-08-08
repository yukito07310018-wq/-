import { NextResponse } from "next/server";
import { buildHealthReport } from "@/lib/api/health";
import { renderHealthPage } from "@/lib/api/healthPage";
import { toApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * §3 — configuration and connectivity probe.
 *
 * A browser gets a page with the verdict and the steps that fix it; scripts get
 * JSON. The person who can change a Vercel environment variable is not
 * necessarily the person who can read a JSON blob, and this endpoint is only
 * useful if they can act on it.
 *
 * `?probe=0` skips the upstream model call, `?format=json` forces JSON.
 * Responses never contain the API key (see redact() in lib/api/health).
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const params = new URL(request.url).searchParams;
    const report = await buildHealthReport(params.get("probe") !== "0");
    const status = report.ok ? 200 : 503;

    const wantsHtml =
      params.get("format") !== "json" &&
      (request.headers.get("accept") ?? "").includes("text/html");

    if (wantsHtml) {
      return new NextResponse(renderHealthPage(report), {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json(report, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toApiError(error, "health");
  }
}
