import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Model wrapper: timeout, retry, JSON extraction and schema repair (§36/§39).
 *
 * Two providers are supported, chosen by AI_PROVIDER:
 *  - "anthropic" (default): the Anthropic Messages API.
 *  - "ollama": a local Ollama server, for running entirely offline with no
 *    API key. Every call site above this module (analystCall, interviewerCall,
 *    distressCheck) is provider-agnostic — they only see callModel /
 *    callModelStructured, so switching providers never touches prompts or
 *    schemas.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-5";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * CPU-only local inference is far slower than a hosted API — a 7B model
 * generating 1500 tokens on 4 cores can take well over a minute. The default
 * below is generous on purpose; override with AI_REQUEST_TIMEOUT_MS if needed.
 */
export const OLLAMA_DEFAULT_TIMEOUT_MS = 180_000;
export const MAX_TRANSPORT_RETRIES = 2;
export const MAX_REPAIR_ATTEMPTS = 2;

export class AiUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export type AiProvider = "anthropic" | "ollama";

export function getProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  return raw === "ollama" ? "ollama" : "anthropic";
}

export function getModelId(): string {
  if (getProvider() === "ollama") {
    return process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  }
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
}

function getRequestTimeoutMs(): number {
  const override = process.env.AI_REQUEST_TIMEOUT_MS?.trim();
  if (override) {
    const parsed = Number(override);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return getProvider() === "ollama" ? OLLAMA_DEFAULT_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/**
 * Whether enough configuration exists to attempt a call at all. Ollama needs
 * no secret, so this only gates on the Anthropic API key when that provider
 * is selected — used by /api/interview/start to fail fast with a clear
 * Japanese message instead of a confusing error mid-conversation.
 */
export function hasAiCredentials(): boolean {
  return getProvider() === "ollama" ? true : Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let anthropicClient: Anthropic | null = null;

export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AiUnavailableError(
      "ANTHROPIC_API_KEY が設定されていません。.env に API キーを設定してから起動してください。"
    );
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
      maxRetries: 0, // retries are handled here so backoff and logging stay uniform
    });
  }
  return anthropicClient;
}

/** Reset for tests / after an env change. */
export function resetClient(): void {
  anthropicClient = null;
}

export interface TokenUsage {
  input: number;
  output: number;
}

const usageLog: { label: string; usage: TokenUsage; model: string }[] = [];

export function recordUsage(label: string, usage: TokenUsage, model: string): void {
  usageLog.push({ label, usage, model });
  console.info(`[ai] ${label} model=${model} in=${usage.input} out=${usage.output}`);
}

export function getUsageLog(): readonly { label: string; usage: TokenUsage; model: string }[] {
  return usageLog;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 429;
}

function isRetryableStatus(error: unknown): boolean {
  if (isRateLimit(error)) return true;
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: number }).status;
    return typeof status === "number" && status >= 500;
  }
  return false;
}

export interface RawCallOptions {
  label: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /**
   * Anthropic-only: a partial assistant turn that forces the reply to
   * continue as JSON. Ignored by the Ollama path, which uses native JSON
   * mode instead (see `json`).
   */
  prefill?: string;
  /**
   * Hint that the caller needs valid JSON back. callModelStructured sets this
   * automatically. The Anthropic path ignores it (prefill already does the
   * job); the Ollama path turns it into `format: "json"`.
   */
  json?: boolean;
}

class OllamaModelNotFoundError extends Error {}

/** One completion via the Anthropic Messages API, with timeout + retry. */
async function callAnthropic(options: RawCallOptions): Promise<string> {
  const anthropic = getClient();
  const model = getModelId();
  const timeoutMs = getRequestTimeoutMs();

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: options.user }];
      if (options.prefill) messages.push({ role: "assistant", content: options.prefill });

      const response = await anthropic.messages.create(
        {
          model,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          system: options.system,
          messages,
        },
        { signal: controller.signal }
      );

      recordUsage(
        options.label,
        { input: response.usage.input_tokens, output: response.usage.output_tokens },
        model
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return (options.prefill ?? "") + text;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableStatus(error) || controller.signal.aborted;
      if (!retryable || attempt === MAX_TRANSPORT_RETRIES) break;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (isRateLimit(lastError)) {
    throw new RateLimitedError("AI の利用制限に達しました。少し待ってからお試しください。");
  }
  throw new AiUnavailableError("AI への接続に失敗しました。", lastError);
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** One completion via a local Ollama server, with timeout + retry. */
async function callOllama(options: RawCallOptions): Promise<string> {
  const model = getModelId();
  const baseUrl = getOllamaBaseUrl();
  const timeoutMs = getRequestTimeoutMs();

  const body = {
    model,
    stream: false,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    ...(options.json ? { format: "json" } : {}),
    options: {
      temperature: options.temperature,
      num_predict: options.maxTokens,
    },
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 404) {
        const detail = await res.text().catch(() => "");
        throw new OllamaModelNotFoundError(detail);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`ollama http ${res.status}: ${detail}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as OllamaChatResponse;
      if (data.error) throw new Error(`ollama error: ${data.error}`);

      recordUsage(
        options.label,
        { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0 },
        model
      );

      return data.message?.content ?? "";
    } catch (error) {
      if (error instanceof OllamaModelNotFoundError) {
        throw new AiUnavailableError(
          `Ollamaにモデル "${model}" が見つかりません。ターミナルで \`ollama pull ${model}\` を実行してください。`,
          error
        );
      }
      lastError = error;
      const retryable = isRetryableStatus(error) || controller.signal.aborted || isNetworkError(error);
      if (!retryable || attempt === MAX_TRANSPORT_RETRIES) break;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (isConnectionRefused(lastError)) {
    throw new AiUnavailableError(
      `Ollamaサーバーに接続できませんでした（${baseUrl}）。ターミナルで \`ollama serve\` を起動してください。`,
      lastError
    );
  }
  throw new AiUnavailableError("AI（Ollama）への接続に失敗しました。", lastError);
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError; // fetch throws TypeError for network-level failures
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "ECONNREFUSED" || error.message.includes("ECONNREFUSED");
}

/** One completion, routed to the configured provider. */
export async function callModel(options: RawCallOptions): Promise<string> {
  return getProvider() === "ollama" ? callOllama(options) : callAnthropic(options);
}

/**
 * Extracts a JSON object from a model reply: strips markdown fences and any
 * prose surrounding the outermost {...} block.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);

  return text.trim();
}

export interface StructuredCallOptions<T> extends RawCallOptions {
  schema: z.ZodType<T>;
}

/**
 * A model call that must produce schema-valid JSON.
 * On parse/validation failure the same call is retried with the error appended,
 * up to MAX_REPAIR_ATTEMPTS; the caller decides what to do if that still fails.
 */
export async function callModelStructured<T>(options: StructuredCallOptions<T>): Promise<T> {
  let feedback = "";

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const raw = await callModel({
      ...options,
      json: true,
      user: feedback ? `${options.user}\n\n${feedback}` : options.user,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      feedback = `前回の出力は JSON として解析できませんでした。マークダウンや説明文を含めず、JSON オブジェクトのみを出力してください。`;
      console.warn(`[ai] ${options.label}: JSON parse failed (attempt ${attempt + 1})`);
      if (attempt < MAX_REPAIR_ATTEMPTS) await sleep(1000 * 2 ** attempt);
      continue;
    }

    const result = options.schema.safeParse(parsed);
    if (result.success) return result.data;

    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    feedback = `前回の出力はスキーマ検証に失敗しました: ${issues}。スキーマに厳密に従った JSON のみを出力してください。`;
    console.warn(`[ai] ${options.label}: schema validation failed (attempt ${attempt + 1}): ${issues}`);
    if (attempt < MAX_REPAIR_ATTEMPTS) await sleep(1000 * 2 ** attempt);
  }

  throw new AiUnavailableError(`${options.label}: 有効な JSON を取得できませんでした。`);
}

/** Startup connectivity probe (§3): fails loudly with an actionable message. */
export async function verifyModelAccess(): Promise<void> {
  const model = getModelId();

  if (getProvider() === "ollama") {
    const baseUrl = getOllamaBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model }),
      });
      if (res.status === 404) {
        throw new AiUnavailableError(
          `Ollamaにモデル "${model}" が見つかりません。ターミナルで \`ollama pull ${model}\` を実行してください。`
        );
      }
      if (!res.ok) {
        throw new Error(`ollama http ${res.status}`);
      }
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      throw new AiUnavailableError(
        `Ollamaサーバー（${baseUrl}）に接続できませんでした。\`ollama serve\` が起動しているか、OLLAMA_BASE_URL の設定を確認してください。`,
        error
      );
    }
    return;
  }

  try {
    const anthropic = getClient();
    await anthropic.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    });
  } catch (error) {
    throw new AiUnavailableError(
      `モデル "${model}" に接続できませんでした。ANTHROPIC_MODEL と ANTHROPIC_API_KEY を確認してください。`,
      error
    );
  }
}
