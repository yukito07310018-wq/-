/**
 * Minimal stand-in for the Anthropic Messages API, used to exercise the full
 * interview loop locally without a real API key.
 *
 *   node scripts/mockAnthropic.mjs &
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=mock npm run dev
 *
 * It answers each of the app's four calls by looking at the system prompt, and
 * grounds analyst quotes in the actual user answer so quote verification passes.
 *
 * MOCK_MODE (or POST /__mock/mode) reproduces the two ways the loop goes quiet
 * without erroring, which are otherwise only observable in production:
 *
 *   grounded   … healthy (default)
 *   ungrounded … Call A answers, but every quote is fabricated → all dropped
 *   outage     … Call A fails outright → the turn continues with zero evidence
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const MODES = new Set(["grounded", "ungrounded", "outage"]);
let mode = MODES.has(process.env.MOCK_MODE ?? "") ? process.env.MOCK_MODE : "grounded";

/** Quotes that are deliberately absent from the user's answer. */
const FABRICATED_QUOTES = [
  "私は常に自分の信念を貫く強い人間だと自負しています",
  "どんな状況でも冷静さを失わないのが自分の長所です",
  "他人の評価はまったく気にしないと決めています",
];

/** Pulls the user's answer back out of the <user_answer> envelope. */
function extractAnswer(text) {
  const m = text.match(/<user_answer>\n([\s\S]*?)\n<\/user_answer>/);
  return m ? m[1] : "";
}

/** Grabs `count` real substrings of the answer, each 12-60 chars. */
function realQuotes(answer, count) {
  const sentences = answer
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => [...s].length >= 12);
  const quotes = [];
  for (const s of sentences) {
    quotes.push([...s].slice(0, 60).join(""));
    if (quotes.length >= count) break;
  }
  return quotes;
}

const ELEMENT_POOL = ["E001", "E051", "E029", "E066", "E081", "E018", "E021", "E092"];

// Rotated independently of the element so evidence diversity actually varies.
const TYPE_POOL = [
  "personal_experience",
  "decision_example",
  "behavioral_example",
  "value_statement",
  "self_description",
  "reasoning_pattern",
  "emotional_reaction",
];

let analystTurn = 0;

function analystResponse(userPrompt) {
  const answer = extractAnswer(userPrompt);
  const quotes = mode === "ungrounded" ? FABRICATED_QUOTES : realQuotes(answer, 3);
  analystTurn += 1;

  const evidence = quotes.map((quote, i) => ({
    element_id: ELEMENT_POOL[(analystTurn + i) % ELEMENT_POOL.length],
    quote,
    type: TYPE_POOL[(analystTurn * 2 + i) % TYPE_POOL.length],
    strength: 0.8,
    reliability: 0.8,
    // Flip direction periodically so contradiction detection gets exercised.
    direction: analystTurn % 5 === 0 && i === 0 ? "negative" : "positive",
    context: "モック応答による説明文。",
  }));

  return JSON.stringify({ evidence, contradiction_candidates: [] });
}

let questionCounter = 0;

function interviewerResponse() {
  questionCounter += 1;
  const kinds = ["experience", "behavior", "decision", "value", "future", "relationship"];
  const questions = [0, 1, 2].map((i) => ({
    text: `モック質問${questionCounter}-${i}：${["これまでに", "最近", "以前"][i]}あなたが自分で決めて動いた場面を、具体的に教えてください。`,
    target_elements: [ELEMENT_POOL[(questionCounter + i) % ELEMENT_POOL.length]],
    probe_kind: kinds[(questionCounter + i) % kinds.length],
    expected_yield: 0.7 - i * 0.1,
    rationale: "mock",
  }));
  return JSON.stringify({ questions });
}

const server = createServer((req, res) => {
  // Flip failure modes without restarting, so one run can cover every branch.
  if (req.url === "/__mock/mode") {
    if (req.method !== "POST") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ mode }));
      return;
    }
    let next = "";
    req.on("data", (chunk) => (next += chunk));
    req.on("end", () => {
      next = next.trim();
      if (!MODES.has(next)) {
        res.writeHead(400).end(`unknown mode: ${next}`);
        return;
      }
      mode = next;
      console.log(`[mockAnthropic] mode -> ${mode}`);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ mode }));
    });
    return;
  }

  if (!req.url?.endsWith("/v1/messages") || req.method !== "POST") {
    res.writeHead(404).end("not found");
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    const system = payload.system ?? "";
    const userPrompt = payload.messages?.[0]?.content ?? "";

    let text;
    if (system.includes("safety classifier")) {
      // Keyword hooks so the distress/crisis branches can be exercised locally.
      const answer = extractAnswer(userPrompt);
      const level = answer.includes("MOCK_CRISIS")
        ? "crisis"
        : answer.includes("MOCK_DISTRESS")
          ? "distress"
          : "none";
      text = JSON.stringify({ level, reason: "mock" });
    } else if (system.includes("personal-modeling analyst")) {
      if (mode === "outage") {
        console.log("[mockAnthropic] analyst -> 500 (outage mode)");
        res.writeHead(500, { "Content-Type": "application/json" }).end(
          JSON.stringify({ type: "error", error: { type: "api_error", message: "mock outage" } })
        );
        return;
      }
      text = analystResponse(userPrompt);
    } else if (system.includes("adaptive interviewer")) {
      text = interviewerResponse();
    } else {
      text = "なるほど、詳しく話してくださってありがとうございます。";
    }

    // The app prefills the assistant turn, so strip the prefix it already holds.
    const prefill = payload.messages?.[1]?.content;
    if (typeof prefill === "string" && text.startsWith(prefill)) {
      text = text.slice(prefill.length);
    }

    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: payload.model,
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 500, output_tokens: 200 },
      })
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mockAnthropic] listening on http://127.0.0.1:${PORT}`);
});
