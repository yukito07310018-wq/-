/**
 * Minimal stand-in for the Anthropic Messages API, used to exercise the full
 * interview loop locally without a real API key.
 *
 *   node scripts/mockAnthropic.mjs &
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=mock npm run dev
 *
 * It answers each of the app's calls by looking at the system prompt, and
 * grounds the reading's quotes in what the user actually said so that quote
 * verification passes rather than dropping everything.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8787);

/** Pulls the user's answer back out of the <user_answer> envelope. */
function extractAnswer(text) {
  const m = text.match(/<user_answer>\n([\s\S]*?)\n<\/user_answer>/);
  return m ? m[1] : "";
}

/** Every USER line of the transcript the reader prompt lays out, with its turn. */
function userTurns(userPrompt) {
  const lines = [...userPrompt.matchAll(/^USER \(turn (\d+)\): (.*)$/gm)];
  return lines.map((m) => ({ turn: Number(m[1]), text: m[2] }));
}

/** Real substrings of an utterance, 12-60 characters each. */
function realQuotes(text, count) {
  const quotes = [];
  for (const sentence of text.split(/[。\n]/).map((s) => s.trim())) {
    if ([...sentence].length < 12) continue;
    quotes.push([...sentence].slice(0, 60).join(""));
    if (quotes.length >= count) break;
  }
  return quotes;
}

const ELEMENT_POOL = ["E001", "E051", "E029", "E066", "E081", "E018", "E021", "E092"];

/**
 * A reading of the whole conversation: turns grouped into blocks of two, with
 * the third block deliberately returning to the first block's element so the
 * return counting has something to count.
 */
function readerResponse(userPrompt) {
  const turns = userTurns(userPrompt);
  const segments = [];

  for (let i = 0; i < turns.length; i += 2) {
    const block = turns.slice(i, i + 2);
    const index = Math.floor(i / 2);
    segments.push({
      from_turn: block[0].turn,
      to_turn: block[block.length - 1].turn,
      // Block 2 goes back to block 0's subject; block 3 is unlabelled.
      element_id:
        index === 2 ? ELEMENT_POOL[0] : index === 3 ? null : ELEMENT_POOL[index % ELEMENT_POOL.length],
      quotes: block.flatMap((t) => realQuotes(t.text, 2)),
    });
  }

  return JSON.stringify({ segments });
}

let questionCounter = 0;

function interviewerResponse(userPrompt) {
  questionCounter += 1;
  const answer = extractAnswer(userPrompt);
  const kinds = ["experience", "behavior", "decision", "value", "future", "relationship"];
  // MOCK_FLAT in an answer exercises the early topic release.
  const signal = answer.includes("MOCK_FLAT") ? "flat_unknown" : "normal";

  const questions = [0, 1, 2].map((i) => ({
    text: `モック質問${questionCounter}-${i}：そのとき、${["どうしたかった", "何が引っかかっていた", "どうなっていたら良かった"][i]}と思いますか。`,
    probe_kind: kinds[(questionCounter + i) % kinds.length],
    expected_yield: 0.7 - i * 0.1,
    rationale: "mock",
  }));
  return JSON.stringify({ answer_signal: signal, questions });
}

const server = createServer((req, res) => {
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
    } else if (system.includes("You read a finished interview")) {
      text = readerResponse(userPrompt);
    } else if (system.includes("You are an adaptive interviewer")) {
      text = interviewerResponse(userPrompt);
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
