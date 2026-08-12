import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runAll, type Finding } from "./experiments";
import { makeRng } from "./lib/rng";
import { makePersona } from "./lib/persona";
import { recordBatches, replayTurns, runInterview } from "./lib/harness";
import { posteriorEstimate } from "@/lib/engine/scoreEngine";
import type { Evidence, EvidenceDraft } from "@/lib/types/diagnosis";

/**
 * Entry point: `npm run validate`.
 *
 * Runs the study and writes `validation/report/`. The assertions here are
 * deliberately weak — this file's job is to produce measurements, not to fail
 * the build because the model has a known weakness. The one thing it does
 * enforce is that the parameterised replica still matches the shipped formula,
 * because a drifted replica would make every sensitivity number meaningless.
 */

const OUT_DIR = path.resolve(import.meta.dirname, "report");

const VERDICT_MARK: Record<Finding["verdict"], string> = {
  pass: "✅ 妥当",
  warn: "⚠️ 条件付き",
  fail: "❌ 成立しない",
};

function toMarkdown(findings: Finding[]): string {
  const lines: string[] = [];
  lines.push("# 測定モデルとしての検証レポート");
  lines.push("");
  lines.push(
    "`src/lib/engine` の実装をそのまま呼び出し、**真の特性値が既知の合成回答者**に対して回して測定した結果です。"
  );
  lines.push(
    "抽出（Claude）は誤りゼロの理想的な抽出器として模擬しているため、ここに出る誤差はすべて計算式に由来します。実運用の精度はこれより悪くなります。"
  );
  lines.push("");
  lines.push("再現方法: `npm run validate`（乱数はすべて固定シード）");
  lines.push("");
  lines.push("## 結果一覧");
  lines.push("");
  lines.push("| # | 検証した問い | 判定 |");
  lines.push("|---|---|---|");
  for (const f of findings) {
    lines.push(`| ${f.id} | ${f.question} | ${VERDICT_MARK[f.verdict]} |`);
  }
  lines.push("");

  for (const f of findings) {
    lines.push(`## ${f.id}. ${f.question}`);
    lines.push("");
    lines.push(`**判定: ${VERDICT_MARK[f.verdict]}**`);
    lines.push("");
    lines.push(f.headline);
    lines.push("");
    lines.push("| 指標 | 値 |");
    lines.push("|---|---|");
    for (const [k, v] of Object.entries(f.metrics)) lines.push(`| \`${k}\` | ${v} |`);
    lines.push("");
    if (f.detail) {
      for (const [key, value] of Object.entries(f.detail)) {
        if (!Array.isArray(value) || value.length === 0) continue;
        const rows = value as Record<string, unknown>[];
        const cols = Object.keys(rows[0]!);
        lines.push(`<details><summary>${key}</summary>`);
        lines.push("");
        lines.push(`| ${cols.join(" | ")} |`);
        lines.push(`|${cols.map(() => "---").join("|")}|`);
        for (const row of rows) lines.push(`| ${cols.map((c) => String(row[c])).join(" | ")} |`);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

describe("validation study", () => {
  it("a full interview leaves every element at the posterior of its own evidence", () => {
    // End-to-end check that the state the app persists is the estimate the
    // formula defines — no accumulated residue, no path dependence anywhere in
    // the turn pipeline. Everything the study measures rests on this.
    const run = runInterview(makePersona("P-fidelity", "fidelity", 606), { turns: 40, seed: 909 });

    const byElement = new Map<string, Evidence[]>();
    for (const e of run.evidence) {
      const list = byElement.get(e.element_id);
      if (list) list.push(e);
      else byElement.set(e.element_id, [e]);
    }

    let checked = 0;
    for (const [elementId, evidence] of byElement) {
      const state = run.states.get(elementId);
      expect(state).toBeDefined();
      expect(state!.score).toBeCloseTo(posteriorEstimate(evidence).score, 10);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("is invariant to the order the same answers arrive in", () => {
    const persona = makePersona("P-order-spec", "order", 111);
    const batches = recordBatches(persona, { turns: 30, seed: 222 });
    const baseline = replayTurns(batches);
    const permuted = replayTurns(makeRng(333).shuffle(batches) as EvidenceDraft[][]);

    for (const [elementId, state] of baseline.states) {
      const other = permuted.states.get(elementId);
      expect(other).toBeDefined();
      expect(other!.score).toBeCloseTo(state.score, 10);
    }
  });

  it("runs the study and writes the report", () => {
    const findings = runAll();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "validation-report.md"), toMarkdown(findings), "utf8");
    writeFileSync(
      path.join(OUT_DIR, "validation-report.json"),
      JSON.stringify({ generated_by: "npm run validate", findings }, null, 2),
      "utf8"
    );

    for (const f of findings) {
      console.log(`\n[${f.id}] ${VERDICT_MARK[f.verdict]} ${f.question}\n  ${f.headline}`);
      console.log(`  ${JSON.stringify(f.metrics)}`);
    }

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => Object.keys(f.metrics).length > 0)).toBe(true);
  });
});
