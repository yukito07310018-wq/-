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

/**
 * Turns the upstream HTTP status into the specific thing to go and fix.
 *
 * "接続できませんでした" is true but useless: a wrong key and a wrong model id
 * produce identical symptoms downstream (zero evidence, every turn), and the
 * whole point of this endpoint is to say which one you are looking at.
 */
export function diagnoseUpstreamStatus(status: number | undefined): string | null {
  switch (status) {
    case 401:
      return "ANTHROPIC_API_KEY が無効です（認証拒否）。キーの値を確認してください。";
    case 403:
      return "ANTHROPIC_API_KEY にこのモデルへの権限がありません。";
    case 404:
      return "ANTHROPIC_MODEL のモデルIDが存在しません。キーではなくモデル名の問題です。";
    case 429:
      return "利用制限に達しています。設定は正しく、時間をおけば回復します。";
    default:
      if (status !== undefined && status >= 500) {
        return "上流が一時的に不調です。設定ではなく相手側の問題の可能性があります。";
      }
      return null;
  }
}

/** Digs the transport status out of the AiUnavailableError the probe wraps. */
function statusOf(error: unknown): number | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause;
  for (const candidate of [cause, error]) {
    const status = (candidate as { status?: unknown } | null)?.status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

async function checkApiKey(): Promise<HealthCheck> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return { ok: false, detail: "ANTHROPIC_API_KEY が未設定です" };
  }
  // Length only — never the value, not even a prefix.
  return { ok: true, detail: `設定済み (${key.length}文字)` };
}

/**
 * The probe is a billed upstream call on an unauthenticated route, so its
 * result is reused briefly. Short enough that an operator retrying after a
 * config change sees the new answer, long enough that repeated hits cannot
 * turn a health check into a spend.
 */
export const PROBE_CACHE_MS = 30_000;
let cachedProbe: { at: number; check: HealthCheck } | null = null;

/** Test seam — the cache is process-wide and would otherwise leak between cases. */
export function resetProbeCache(): void {
  cachedProbe = null;
}

async function checkModelReachable(): Promise<HealthCheck> {
  if (cachedProbe && Date.now() - cachedProbe.at < PROBE_CACHE_MS) {
    return cachedProbe.check;
  }

  let check: HealthCheck;
  try {
    await verifyModelAccess();
    check = { ok: true, detail: "疎通OK" };
  } catch (error) {
    const status = statusOf(error);
    const diagnosis = diagnoseUpstreamStatus(status);
    check = {
      ok: false,
      detail: diagnosis
        ? `HTTP ${status} — ${diagnosis}`
        : `${describeError(error)}（HTTPステータスなし＝接続自体が成立していません）`,
    };
  }

  cachedProbe = { at: Date.now(), check };
  return check;
}

/**
 * Database errors are reported by class only.
 *
 * Driver text carries connection strings, internal hostnames and private IPs,
 * and this endpoint is unauthenticated — redact() only removes key-shaped
 * strings, so it would not catch any of that. The full error goes to the log,
 * which is where an operator can safely read it (§39).
 */
async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, detail: "接続OK" };
  } catch (error) {
    console.error("[health] database check failed:", error);
    const name = error instanceof Error ? error.name : "UnknownError";
    return { ok: false, detail: `接続できません (${name})。DATABASE_URL とログを確認してください` };
  }
}

/** Postgres error for "relation does not exist", surfaced by Prisma as P2021. */
const PRISMA_TABLE_MISSING = "P2021";

/** Whether the TurnDiagnostic migration has been applied (it is applied by hand). */
async function checkDiagnosticTable(): Promise<HealthCheck> {
  try {
    await prisma.turnDiagnostic.count();
    return { ok: true, detail: "移行適用済み" };
  } catch (error) {
    console.error("[health] diagnostic table check failed:", error);
    const code = (error as { code?: string } | null)?.code;
    if (code === PRISMA_TABLE_MISSING) {
      return {
        ok: false,
        detail:
          "TurnDiagnostic が存在しません。npm run db:migrate を実行してください（対話は動きますが原因判定は効きません）",
      };
    }
    // Anything else is not a pending migration, and saying so would send the
    // operator to the wrong fix.
    const name = error instanceof Error ? error.name : "UnknownError";
    return { ok: false, detail: `確認できません (${name})。ログを確認してください` };
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
    return `Evidence抽出（Call A）が毎ターン失敗します。会話は続きますが根拠は0件のままになり、結果画面は「情報不足」になります。→ ${checks.anthropic_reachable.detail}`;
  }
  if (!checks.database.ok) return "DBに接続できません。DATABASE_URL を確認してください。";
  if (!checks.turn_diagnostic_table.ok) {
    return "対話と診断は動きますが、抽出失敗の原因判定は記録されません。npm run db:migrate を実行してください。";
  }
  return null;
}
