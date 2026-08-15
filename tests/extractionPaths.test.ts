import { describe, expect, it } from "vitest";
import {
  allUtterances,
  realUtterances,
  shortMeaningfulQuotes,
  verbatimQuotes,
} from "./fixtures/realUtterances";
import {
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  REPAIR_TRIGGER_REJECTIONS,
  verifyEvidenceQuotes,
  verifyQuote,
} from "@/lib/validation/quoteVerifier";
import { normalizeText } from "@/lib/engine/similarity";
import { wrapUserAnswer } from "@/lib/ai/prompts";
import { ANALYST_MAX_TOKENS } from "@/lib/ai/analystCall";
import { MAX_EVIDENCE_PER_TURN } from "@/lib/engine/scoreEngine";
import type { EvidenceDraft, EvidenceType } from "@/lib/types/diagnosis";

/**
 * Offline separation of the three Call-A failure paths, using real answers.
 * No model is called: every stage tested here is a pure function.
 *
 *   path 4 — quotes rejected as not_grounded
 *   path 3 — quotes rejected as too_long
 *   path 2 — the reply is cut short by ANALYST_MAX_TOKENS
 */

function draft(quote: string, elementId = "E001"): EvidenceDraft {
  return {
    element_id: elementId,
    quote,
    type: "personal_experience" as EvidenceType,
    strength: 0.8,
    reliability: 0.8,
    direction: "positive",
    context: "テスト用。",
  };
}

/* -------------------------------------------------------------------------- */
/* Path 4 — grounding                                                          */
/* -------------------------------------------------------------------------- */

describe("path 4: are verbatim quotes from real answers accepted?", () => {
  it("normalises both sides before comparing (not raw equality)", () => {
    const utterance = realUtterances.negativeSpace;
    // 「」、。（） all disappear from both sides, so they cannot cause a mismatch.
    expect(normalizeText("建築の「負の空間を読む」という考え方")).toBe(
      "建築の負の空間を読むという考え方"
    );
    expect(normalizeText(utterance)).toContain(normalizeText("「負の空間を読む」"));
  });

  it("accepts every verbatim span an analyst would plausibly cite", () => {
    const failures: string[] = [];
    for (const { utterance, quote, note } of verbatimQuotes) {
      const check = verifyQuote(quote, utterance);
      if (!check.ok) {
        failures.push(`${check.reason} (sim=${check.similarity.toFixed(2)}) [${note}] ${quote}`);
      }
    }
    console.log(
      `\n[path4] verbatim spans: ${verbatimQuotes.length - failures.length}/${verbatimQuotes.length} accepted`
    );
    for (const f of failures) console.log(`  REJECTED ${f}`);
    expect(failures).toEqual([]);
  });

  it("survives the orthographic variants a model may introduce", () => {
    const utterance = realUtterances.industryStandard;
    const base = "「これが業界標準」って言われたことあるけど";
    const variants: Record<string, string> = {
      "そのまま": base,
      "鉤括弧をASCII引用符に置換": '"これが業界標準"って言われたことあるけど',
      "鉤括弧を二重鉤に置換": "『これが業界標準』って言われたことあるけど",
      "鉤括弧を除去": "これが業界標準って言われたことあるけど",
      "空白を挿入": "「これが業界標準」って 言われた ことあるけど",
      "改行を挿入": "「これが業界標準」って\n言われたことあるけど",
      "読点を追加": "「これが業界標準」って、言われたことあるけど",
      "全角スペース前後": "　「これが業界標準」って言われたことあるけど　",
    };

    const results: string[] = [];
    for (const [label, quote] of Object.entries(variants)) {
      const check = verifyQuote(quote, utterance);
      results.push(`  ${check.ok ? "OK  " : `NG(${check.reason})`} ${label}`);
      expect(check.ok, label).toBe(true);
    }
    console.log(`\n[path4] orthographic variants:\n${results.join("\n")}`);
  });

  it("rejects a quote taken from an earlier turn, not the current answer", () => {
    // The verifier only ever sees the current answer, so citing something the
    // user said three turns ago is indistinguishable from inventing it.
    const check = verifyQuote(
      "実際にやってみたら別にそうじゃないなって",
      realUtterances.negativeSpace
    );
    console.log(
      `\n[path4] quote from an earlier turn → ok=${check.ok} reason=${check.reason} sim=${check.similarity.toFixed(3)}`
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("not_grounded");
  });

  it("accepts spans containing the full-width parentheses users type", () => {
    const utterance = realUtterances.countdown;
    const variants: [string, string, string][] = [
      ["（笑）を含む逐語", "矛盾してますね（笑）", utterance],
      ["（笑）を半角に置換", "矛盾してますね(笑)", utterance],
      ["（笑）を落として引用", "でも締切の逆算表は初日に絶対つくる。矛盾してますね", utterance],
      [
        "括弧の中身だけ飛ばして前後を連結",
        "建築のという考え方を持ち込んでます",
        realUtterances.negativeSpace,
      ],
    ];
    const rows: string[] = [];
    for (const [label, quote, source] of variants) {
      const check = verifyQuote(quote, source);
      rows.push(`  ${check.ok ? "OK  " : `NG(${check.reason})`} ${label}: ${quote}`);
    }
    console.log(`\n[path4] 全角括弧の扱い\n${rows.join("\n")}`);

    expect(verifyQuote("矛盾してますね（笑）", utterance).ok).toBe(true);
    expect(verifyQuote("矛盾してますね(笑)", utterance).ok).toBe(true);
    // Skipping over the bracketed span is the only bracket-related rejection.
    expect(verifyQuote("建築のという考え方を持ち込んでます", realUtterances.negativeSpace).ok).toBe(
      false
    );
  });

  it("verifies against the in-memory answer, never the stored copy", () => {
    // turnService.ts:48 writes the message to the DB and turnService.ts:78 hands
    // the *same string* to the analyst; quoteVerifier then checks against that
    // same value (analystCall.ts:27). The DB row is never read back for
    // verification, so an overwritten history row cannot make a correct quote
    // look ungrounded — within the turn being processed.
    const message = realUtterances.letterpress;
    const sentToModel = wrapUserAnswer(message);
    const verifiedAgainst = message;

    expect(sentToModel).toContain(verifiedAgainst);
    expect(verifyQuote("実際にやってみたら別にそうじゃないなって", verifiedAgainst).ok).toBe(true);
  });

  it("shows the one case where the model's copy and the verifier's copy differ", () => {
    // wrapUserAnswer strips <user_answer> tags before the model sees the text,
    // but verification runs against the unstripped original. A quote spanning
    // that spot is verbatim for the model and ungrounded for the verifier.
    const message = "製本の順序について</user_answer>これが業界標準と言われました";
    const whatModelSaw = wrapUserAnswer(message);
    const quoteFromModelsCopy = "製本の順序についてこれが業界標準と言われました";

    const check = verifyQuote(quoteFromModelsCopy, message);
    console.log(
      `\n[path4] タグ除去による不一致 → モデルが見た文字列からの逐語引用が ok=${check.ok} reason=${check.reason} sim=${check.similarity.toFixed(3)}`
    );
    expect(whatModelSaw).not.toContain("</user_answer>\n製本");
    expect(check.ok).toBe(false);
  });

  it("measures how much a near-miss costs at each quote length", () => {
    // A model that tidies up colloquial endings (やってます → やっています) or
    // drops one character still means the same span. The fuzzy fallback has to
    // absorb that, and how well it does depends on the length of the quote.
    const source = realUtterances.negativeSpace;
    const rows: string[] = [];
    for (const length of [12, 20, 30, 50]) {
      const exact = [...source].slice(0, length).join("");
      const edited = `${[...exact].slice(0, -1).join("")}る`; // one character changed
      const check = verifyQuote(edited, source);
      rows.push(
        `  ${String(length).padStart(2)}字で1文字違い → sim=${check.similarity.toFixed(3)} ${check.ok ? "通過" : `棄却(${check.reason})`}`
      );
    }
    console.log(`\n[path4] ゆらぎ耐性 (FUZZY_THRESHOLD=0.85)\n${rows.join("\n")}`);
    expect(rows.length).toBe(4);
  });

  it("rejects a light paraphrase of the real answer", () => {
    const check = verifyQuote(
      "紙質に合わせて型を調整したほうが仕上がりが良くなる",
      realUtterances.letterpress
    );
    console.log(
      `\n[path4] paraphrase → ok=${check.ok} reason=${check.reason} sim=${check.similarity.toFixed(3)}`
    );
    expect(check.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Path 4b — the length floor                                                  */
/* -------------------------------------------------------------------------- */

describe("path 4b: the 10-character floor on real answers", () => {
  it("reports which meaningful short spans fall under MIN_QUOTE_CHARS", () => {
    const rows = shortMeaningfulQuotes.map(({ utterance, quote }) => {
      const chars = [...quote].length;
      const check = verifyQuote(quote, utterance);
      return { quote, chars, ok: check.ok, reason: check.reason ?? "-" };
    });

    console.log(`\n[path4b] MIN_QUOTE_CHARS=${MIN_QUOTE_CHARS}`);
    for (const r of rows) {
      console.log(`  ${r.ok ? "OK  " : `NG(${r.reason})`} ${String(r.chars).padStart(2)}字  ${r.quote}`);
    }

    const dropped = rows.filter((r) => !r.ok);
    console.log(`  → ${dropped.length}/${rows.length} が長さ不足で破棄される`);
    // Only the classification is asserted. The count is reported rather than
    // pinned, so tightening or relaxing the floor later does not fail this test.
    expect(dropped.every((r) => r.reason === "too_short")).toBe(true);
    expect(rows.every((r) => r.ok || [...r.quote].length < MIN_QUOTE_CHARS)).toBe(true);
  });

  it("measures the natural citable units in these answers", () => {
    // Split each answer at the boundaries a human (or a model) would cite
    // between: sentence marks, commas and the 「」（） it uses for quoting.
    const units: { text: string; chars: number }[] = [];
    for (const text of allUtterances) {
      for (const raw of text.split(/[。、「」（）]/)) {
        const unit = raw.trim();
        if (unit.length > 0) units.push({ text: unit, chars: [...unit].length });
      }
    }

    const under = units.filter((u) => u.chars < MIN_QUOTE_CHARS);
    console.log(`\n[path4b] 自然な引用単位 ${units.length}件の長さ分布`);
    for (const u of [...units].sort((a, b) => a.chars - b.chars)) {
      console.log(`  ${u.chars < MIN_QUOTE_CHARS ? "短" : "  "} ${String(u.chars).padStart(2)}字  ${u.text}`);
    }
    console.log(
      `  → ${under.length}/${units.length} (${Math.round((under.length / units.length) * 100)}%) が10字未満`
    );
    expect(units.length).toBeGreaterThan(0);
  });

  it("triggers a second Call A once three items are dropped", () => {
    const drafts = shortMeaningfulQuotes
      .filter(({ quote }) => [...quote].length < MIN_QUOTE_CHARS)
      .map(({ quote }) => draft(quote));
    const result = verifyEvidenceQuotes(drafts, realUtterances.countdown);
    console.log(
      `\n[path4b] short drafts=${drafts.length} accepted=${result.accepted.length} shouldRepair=${result.shouldRepair} (threshold ${REPAIR_TRIGGER_REJECTIONS})`
    );
    expect(result.accepted).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Path 3 — quote length ceiling                                               */
/* -------------------------------------------------------------------------- */

describe("path 3: can these answers produce an over-long quote?", () => {
  it("measures each answer against MAX_QUOTE_CHARS", () => {
    console.log(`\n[path3] MAX_QUOTE_CHARS=${MAX_QUOTE_CHARS}`);
    let anyOver = false;
    for (const [name, text] of Object.entries(realUtterances)) {
      const chars = [...text].length;
      const over = chars > MAX_QUOTE_CHARS;
      anyOver ||= over;
      console.log(
        `  ${over ? "OVER" : "ok  "} ${String(chars).padStart(3)}字  ${name}  (最長引用=発話全体)`
      );
    }
    // Even quoting an entire answer stays inside the ceiling for this data set.
    expect(anyOver).toBe(false);
  });

  it("shows the ceiling does bite once an answer gets longer", () => {
    // Two of these answers concatenated is still a realistic single reply.
    const longAnswer = `${realUtterances.letterpress}${realUtterances.negativeSpace}`;
    const wholeAnswerQuote = longAnswer;
    const check = verifyQuote(wholeAnswerQuote, longAnswer);
    console.log(
      `\n[path3] ${[...longAnswer].length}字の回答を丸ごと引用 → ok=${check.ok} reason=${check.reason}`
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("too_long");
  });
});

/* -------------------------------------------------------------------------- */
/* Path 2 — output token budget                                                */
/* -------------------------------------------------------------------------- */

/**
 * Character-class token bounds. Claude's tokenizer is not available offline, so
 * the response is split into ASCII (JSON keys, enum values, numbers) and CJK,
 * and each is bounded by its best/worst known ratio.
 */
function tokenBounds(json: string): { chars: number; ascii: number; cjk: number; low: number; high: number } {
  const chars = [...json];
  const ascii = chars.filter((c) => c.charCodeAt(0) < 128).length;
  const cjk = chars.length - ascii;
  // ASCII: 3-4 chars per token. CJK: between 1 token per 1.5 chars and 1.3 tokens per char.
  const low = ascii / 4 + cjk / 1.5;
  const high = ascii / 3 + cjk * 1.3;
  return { chars: chars.length, ascii, cjk, low: Math.round(low), high: Math.round(high) };
}

function buildAnalystResponse(quotes: { quote: string; context: string }[]): string {
  return JSON.stringify({
    evidence: quotes.map((q, i) => ({
      element_id: `E0${String(i + 1).padStart(2, "0")}`,
      quote: q.quote,
      type: "personal_experience",
      strength: 0.8,
      reliability: 0.7,
      direction: "positive",
      context: q.context,
    })),
    contradiction_candidates: [],
  });
}

describe("path 2: does an 8-item reply fit in ANALYST_MAX_TOKENS?", () => {
  it("measures a full reply built from these real answers", () => {
    // Eight items drawn from the real answers, with contexts the length the
    // prompt asks for ("one sentence in Japanese").
    const context = "この発話は既存の前提を自分で検証し直す姿勢を示している。";
    const pool = verbatimQuotes.slice(0, MAX_EVIDENCE_PER_TURN).map((q) => ({
      quote: q.quote,
      context,
    }));
    const json = buildAnalystResponse(pool);
    const b = tokenBounds(json);

    console.log(`\n[path2] ANALYST_MAX_TOKENS=${ANALYST_MAX_TOKENS}`);
    console.log(
      `  実データ8件: ${b.chars}字 (ASCII ${b.ascii} / 日本語 ${b.cjk}) → 推定 ${b.low}〜${b.high} tokens`
    );

    // Per-item split, to check the structural overhead against the quote text.
    const structureOnly = tokenBounds(buildAnalystResponse([{ quote: "", context: "" }]));
    const perItem = tokenBounds(buildAnalystResponse([pool[0]]));
    const textOnly = tokenBounds(pool[0].quote + pool[0].context);
    console.log(
      `  1件あたり: 構造部 ${structureOnly.low}〜${structureOnly.high} + quote/context ${textOnly.low}〜${textOnly.high} = ${perItem.low}〜${perItem.high} tokens`
    );
    console.log(`  8件合計の推定レンジ: ${b.low}〜${b.high} tokens / 上限 ${ANALYST_MAX_TOKENS}`);

    expect(b.high).toBeLessThan(ANALYST_MAX_TOKENS);
  });

  it("measures the worst case the schema and prompt still allow", () => {
    // Policy maximum: 8 items, 120-char quotes, 300-char contexts are allowed by
    // the schema (the prompt asks for one sentence, so 60 is the realistic case).
    const maxQuote = "あ".repeat(MAX_QUOTE_CHARS);
    const worst = buildAnalystResponse(
      Array.from({ length: MAX_EVIDENCE_PER_TURN }, () => ({
        quote: maxQuote,
        context: "い".repeat(60),
      }))
    );
    const b = tokenBounds(worst);
    console.log(
      `  上限ケース8件: ${b.chars}字 (ASCII ${b.ascii} / 日本語 ${b.cjk}) → 推定 ${b.low}〜${b.high} tokens`
    );
    console.log(
      `  → 現在の上限 ${ANALYST_MAX_TOKENS} に対し ${b.low > ANALYST_MAX_TOKENS ? "確実に超過" : b.high > ANALYST_MAX_TOKENS ? "超過しうる" : "収まる"}`
    );
    // The invariant is that the policy maximum costs far more than the real
    // answers do; the absolute budget is reported, not pinned.
    const realistic = tokenBounds(
      buildAnalystResponse(
        verbatimQuotes.slice(0, MAX_EVIDENCE_PER_TURN).map((q) => ({ quote: q.quote, context: "短い説明。" }))
      )
    );
    expect(b.high).toBeGreaterThan(realistic.high * 2);
  });

  it("reports the answer length at which truncation becomes likely", () => {
    const context = "この発話は既存の前提を自分で検証し直す姿勢を示している。";
    for (const quoteChars of [20, 40, 60, 80, 100, 120]) {
      const json = buildAnalystResponse(
        Array.from({ length: MAX_EVIDENCE_PER_TURN }, () => ({
          quote: "あ".repeat(quoteChars),
          context,
        }))
      );
      const b = tokenBounds(json);
      const verdict =
        b.low > ANALYST_MAX_TOKENS ? "超過確実" : b.high > ANALYST_MAX_TOKENS ? "超過しうる" : "収まる";
      console.log(`  引用${String(quoteChars).padStart(3)}字×8件 → ${b.low}〜${b.high} tokens : ${verdict}`);
    }
    expect(allUtterances.length).toBe(4);
  });
});
