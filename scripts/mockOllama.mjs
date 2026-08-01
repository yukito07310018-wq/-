/**
 * Minimal stand-in for a local Ollama server's /api/chat and /api/show
 * endpoints. Used to verify the Ollama provider path in src/lib/ai/client.ts
 * without a real Ollama install (this sandbox's network policy blocks
 * ollama.com, so real Ollama cannot be installed here).
 *
 *   node scripts/mockOllama.mjs &
 *   AI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 \
 *     OLLAMA_MODEL=mock-model npm run dev
 *
 * Response shapes mirror Ollama's real /api/chat (non-streaming) and
 * /api/show so verifyModelAccess() and the chat path both exercise their
 * real parsing logic.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 11434);
const KNOWN_MODEL = process.env.MOCK_MODEL ?? "mock-model";

function extractAnswer(text) {
  const m = text.match(/<user_answer>\n([\s\S]*?)\n<\/user_answer>/);
  return m ? m[1] : "";
}

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

const ELEMENT_POOL = ["E001", "E051", "E029", "E066", "E081", "E018"];
const TYPE_POOL = [
  "personal_experience",
  "decision_example",
  "behavioral_example",
  "value_statement",
  "self_description",
  "reasoning_pattern",
];

let analystTurn = 0;
function analystResponse(userPrompt) {
  const answer = extractAnswer(userPrompt);
  const quotes = realQuotes(answer, 2);
  analystTurn += 1;
  const evidence = quotes.map((quote, i) => ({
    element_id: ELEMENT_POOL[(analystTurn + i) % ELEMENT_POOL.length],
    quote,
    type: TYPE_POOL[(analystTurn + i) % TYPE_POOL.length],
    strength: 0.75,
    reliability: 0.75,
    direction: "positive",
    context: "Ollamaモック応答。",
  }));
  return JSON.stringify({ evidence, contradiction_candidates: [] });
}

let questionCounter = 0;
function interviewerResponse() {
  questionCounter += 1;
  const kinds = ["experience", "behavior", "decision", "value", "future"];
  const questions = [0, 1, 2].map((i) => ({
    text: `Ollamaモック質問${questionCounter}-${i}：最近、自分の判断で動いた具体的な場面を教えてください。`,
    target_elements: [ELEMENT_POOL[(questionCounter + i) % ELEMENT_POOL.length]],
    probe_kind: kinds[(questionCounter + i) % kinds.length],
    expected_yield: 0.7,
    rationale: "mock",
  }));
  return JSON.stringify({ questions });
}

// Deliberately wraps JSON in a code fence + prose sometimes, to prove
// extractJson()/callModelStructured() handle a less disciplined local model.
function maybeMessy(text, turnCounter) {
  if (turnCounter % 3 !== 0) return text;
  return `了解しました。以下がJSONです。\n\`\`\`json\n${text}\n\`\`\`\n以上です。`;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/api/show" && req.method === "POST") {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }
      if (payload.name !== KNOWN_MODEL) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(
          JSON.stringify({ error: `model '${payload.name}' not found` })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ modelfile: "mock", parameters: "", template: "" })
      );
      return;
    }

    if (req.url === "/api/chat" && req.method === "POST") {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }

      if (payload.model !== KNOWN_MODEL) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(
          JSON.stringify({ error: `model '${payload.model}' not found, try pulling it first` })
        );
        return;
      }

      const system = payload.messages?.[0]?.content ?? "";
      const userPrompt = payload.messages?.[1]?.content ?? "";

      let text;
      if (system.includes("safety classifier")) {
        const answer = extractAnswer(userPrompt);
        const level = answer.includes("MOCK_CRISIS")
          ? "crisis"
          : answer.includes("MOCK_DISTRESS")
            ? "distress"
            : "none";
        text = JSON.stringify({ level, reason: "mock" });
      } else if (system.includes("personal-modeling analyst")) {
        text = maybeMessy(analystResponse(userPrompt), analystTurn);
      } else if (system.includes("adaptive interviewer")) {
        text = interviewerResponse();
      } else {
        text = "なるほど、詳しく話してくださってありがとうございます。";
      }

      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          model: payload.model,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: text },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 400,
          eval_count: 150,
        })
      );
      return;
    }

    res.writeHead(404).end("not found");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mockOllama] listening on http://127.0.0.1:${PORT} (model=${KNOWN_MODEL})`);
});
