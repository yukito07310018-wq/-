import { getModelId, verifyModelAccess } from "../ai/client";
import { prisma } from "../db/prisma";
import { ELEMENTS } from "../model/elements";

/**
 * §3 — the connectivity probe, finally reachable from a deployment.
 *
 * `verifyModelAccess()` has existed (and been documented) since the beginning
 * but was never called from anywhere: no route, no script, no startup hook.
 * That is why a dead API key produced five turns of normal-looking conversation
 * with zero evidence and nothing anywhere saying why — every LLM call in the
 * loop is fail-soft, so the failure had no way to surface.
 *
 * This runs the checks that decide whether an interview can produce anything,
 * so the answer is one URL rather than a five-turn experiment.
 */

export interface HealthCheck {
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  ok: boolean;
  checks: Record<string, HealthCheck>;
  hint: string | null;
}

/**
 * Strips anything key-shaped out of upstream error text.
 *
 * This endpoint is unauthenticated, and SDK errors can quote request details.
 * A health check must never be the thing that leaks a credential.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***")
    .replace(/(x-api-key["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1***");
}

function describeError(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`.slice(0, 300));
  return redact(String(error).slice(0, 300));
}

async function checkApiKey(): Promise<HealthCheck> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return { ok: false, detail: "ANTHROPIC_API_KEY が未設定です" };
  }
  // Length only — never the value, not even a prefix.
  return { ok: true, detail: `設定済み (${key.length}文字)` };
}

async function checkModelReachable(): Promise<HealthCheck> {
  try {
    await verifyModelAccess();
    return { ok: true, detail: "疎通OK" };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, detail: "接続OK" };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

/** Whether the TurnDiagnostic migration has been applied (it is applied by hand). */
async function checkDiagnosticTable(): Promise<HealthCheck> {
  try {
    await prisma.turnDiagnostic.count();
    return { ok: true, detail: "移行適用済み" };
  } catch {
    return {
      ok: false,
      detail: "TurnDiagnostic が存在しません。npm run db:migrate を実行してください（対話は動きますが原因判定は効きません）",
    };
  }
}

function checkModelFile(): HealthCheck {
  return ELEMENTS.length === 100
    ? { ok: true, detail: "100要素を読み込み済み" }
    : { ok: false, detail: `要素数が ${ELEMENTS.length} です` };
}

/**
 * `probeModel: false` skips the upstream call, for callers that only want the
 * local configuration picture.
 */
export async function buildHealthReport(probeModel = true): Promise<HealthReport> {
  const [apiKey, database, diagnosticTable] = await Promise.all([
    checkApiKey(),
    checkDatabase(),
    checkDiagnosticTable(),
  ]);

  const checks: Record<string, HealthCheck> = {
    anthropic_api_key: apiKey,
    anthropic_model: { ok: true, detail: getModelId() },
    anthropic_reachable: probeModel
      ? await checkModelReachable()
      : { ok: true, detail: "未実行 (probe=0)" },
    database,
    element_model: checkModelFile(),
    turn_diagnostic_table: diagnosticTable,
  };

  return {
    // The diagnostic table is not required for an interview to work, so a
    // pending migration is reported without failing the whole check.
    ok: Object.entries(checks).every(([name, c]) => c.ok || name === "turn_diagnostic_table"),
    checks,
    hint: buildHint(checks),
  };
}

function buildHint(checks: Record<string, HealthCheck>): string | null {
  if (!checks.anthropic_api_key.ok || !checks.anthropic_reachable.ok) {
    return "Evidence抽出（Call A）が毎ターン失敗します。会話は続きますが根拠は0件のままになり、結果画面は「情報不足」になります。ANTHROPIC_API_KEY と ANTHROPIC_MODEL を確認してください。";
  }
  if (!checks.database.ok) return "DBに接続できません。DATABASE_URL を確認してください。";
  if (!checks.turn_diagnostic_table.ok) {
    return "対話と診断は動きますが、抽出失敗の原因判定は記録されません。npm run db:migrate を実行してください。";
  }
  return null;
}
