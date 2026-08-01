// Generates data/elements.json and data/axes.json from the authored source parts.
// Run: node scripts/genElements.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { part1 } from "./elements/part1.mjs";
import { part2 } from "./elements/part2.mjs";
import { part3 } from "./elements/part3.mjs";
import { definitionTails } from "./elements/definitionTails.mjs";

const AXES = [
  ["AX01", "独自認知", "既存の枠組みに依らず、自分の視点で対象を捉え直す認知の傾向"],
  ["AX02", "創造的生成", "新しい案・概念・表現を実際に生み出す力"],
  ["AX03", "探索性", "未知へ向かい、試し、学び続ける傾向"],
  ["AX04", "価値観・信念", "何を良しとするかの基準と、その保持の強さ"],
  ["AX05", "社会認識", "社会の構造・力学・変化を捉える視野"],
  ["AX06", "意思決定", "不確実な状況で何をどう選ぶかの様式"],
  ["AX07", "行動特性", "考えを実際の行動と成果に変える様式"],
  ["AX08", "対人・社会性", "他者との関係の作り方と集団内での振る舞い"],
  ["AX09", "自己認識", "自分自身をどれだけ正確に捉えているか"],
  ["AX10", "倫理・未来志向", "倫理的感度と、長期・社会規模での視座"],
];

const axisOf = (id) => {
  const n = Number(id.slice(1));
  return AXES[Math.floor((n - 1) / 10)][0];
};

// definition は 60〜120 字。プロンプトへ渡す短縮版は先頭 60 字（§38）。
const shorten = (s) => (s.length <= 60 ? s : s.slice(0, 59) + "…");

const rows = [...part1, ...part2, ...part3];

const elements = rows.map(
  ([element_id, name, base, measurement_target, pos, neg, related, contrast, weight]) => {
    const tail = definitionTails[element_id];
    if (!tail) throw new Error(`missing definition tail for ${element_id}`);
    const definition = base + tail;
    return {
    element_id,
    name,
    definition,
    short_definition: shorten(definition),
    measurement_target,
    positive_evidence_examples: pos,
    negative_evidence_examples: neg,
    related_elements: related,
    contrast_elements: contrast ?? [],
    axis_id: axisOf(element_id),
    weight: weight ?? 1.0,
  };
  }
);

// ---- authoring-time sanity checks (fail loudly before writing) ----
const problems = [];
if (elements.length !== 100) problems.push(`element count = ${elements.length}, expected 100`);
const ids = new Set(elements.map((e) => e.element_id));
if (ids.size !== elements.length) problems.push("duplicate element_id");
for (const [axisId] of AXES) {
  const n = elements.filter((e) => e.axis_id === axisId).length;
  if (n !== 10) problems.push(`${axisId} has ${n} elements, expected 10`);
}
for (const e of elements) {
  const len = [...e.definition].length;
  if (len < 60 || len > 120) problems.push(`${e.element_id} definition length ${len} (need 60-120)`);
  if (e.positive_evidence_examples.length < 2) problems.push(`${e.element_id} needs >=2 positive examples`);
  if (e.negative_evidence_examples.length < 2) problems.push(`${e.element_id} needs >=2 negative examples`);
  if (e.related_elements.length < 2 || e.related_elements.length > 4)
    problems.push(`${e.element_id} related_elements must be 2-4`);
  for (const r of [...e.related_elements, ...e.contrast_elements]) {
    if (!ids.has(r)) problems.push(`${e.element_id} references unknown element ${r}`);
    if (r === e.element_id) problems.push(`${e.element_id} references itself`);
  }
  if (e.weight < 0.5 || e.weight > 1.5) problems.push(`${e.element_id} weight out of range`);
}
if (problems.length) {
  console.error("elements.json generation failed:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}

const axes = AXES.map(([axis_id, name, description]) => ({
  axis_id,
  name,
  description,
  element_ids: elements.filter((e) => e.axis_id === axis_id).map((e) => e.element_id),
}));

mkdirSync("data", { recursive: true });
writeFileSync("data/elements.json", JSON.stringify({ elements }, null, 2) + "\n");
writeFileSync("data/axes.json", JSON.stringify({ axes }, null, 2) + "\n");
console.log(`wrote data/elements.json (${elements.length} elements) and data/axes.json (${axes.length} axes)`);
