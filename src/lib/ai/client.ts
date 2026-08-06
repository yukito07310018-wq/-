import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Anthropic wrapper: timeout, retry, JSON extraction and schema repair (§36/§39).
 *
 * Model id comes from ANTHROPIC_MODEL so it can be changed without a code
 * change; the default below is the fallback, not the only source.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-5";

export const REQUEST_TIMEOUT_MS = 30_000;
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

export function getModelId(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AiUnavailableError(
      "ANTHROPIC_API_KEY が設定されていません。.env に API キーを設定してから起動してください。"
    );
  }
  if (!client) {
    client = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
      maxRetries: 0, // retries are handled here so backoff and logging stay uniform
    });
  }
  return client;
}

/** Reset for tests / after an env change. */
export function resetClient(): void {
  client = null;
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
  /** Forces the reply to start as JSON, removing most prose/fence noise. */
  prefill?: string;
}

/** One completion, with timeout and transport-level retry. */
export async function callModel(options: RawCallOptions): Promise<string> {
  const anthropic = getClient();
  const model = getModelId();

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
  let lastRaw = "";

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const raw = await callModel({
      ...options,
      user: feedback ? `${options.user}\n\n${feedback}` : options.user,
    });

    lastRaw = raw;
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (error) {
      feedback = `前回の出力は JSON として解析できませんでした。マークダウンや説明文を含めず、JSON オブジェクトのみを出力してください。`;
      console.warn(
        `[ai] ${options.label}: JSON parse failed (attempt ${attempt + 1})\nRaw output: ${raw.slice(0, 200)}\nError: ${error}`
      );
      if (attempt < MAX_REPAIR_ATTEMPTS) await sleep(1000 * 2 ** attempt);
      continue;
    }

    const result = options.schema.safeParse(parsed);
    if (result.success) {
      console.info(`[ai] ${options.label}: successfully parsed valid schema (attempt ${attempt + 1})`);
      return result.data;
    }

    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    feedback = `前回の出力はスキーマ検証に失敗しました: ${issues}。スキーマに厳密に従った JSON のみを出力してください。`;
    console.warn(
      `[ai] ${options.label}: schema validation failed (attempt ${attempt + 1}): ${issues}\nParsed data: ${JSON.stringify(parsed).slice(0, 200)}`
    );
    if (attempt < MAX_REPAIR_ATTEMPTS) await sleep(1000 * 2 ** attempt);
  }

  console.error(`[ai] ${options.label}: Final attempt failed. Last raw output: ${lastRaw.slice(0, 500)}`);
  throw new AiUnavailableError(`${options.label}: 有効な JSON を取得できませんでした。`);
}

/** Startup connectivity probe (§3): fails loudly with an actionable message. */
export async function verifyModelAccess(): Promise<void> {
  const model = getModelId();
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
