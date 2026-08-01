/**
 * Drives a whole interview against a running dev server (with the mock API) and
 * prints what the model looks like at the end.
 *
 *   node scripts/mockAnthropic.mjs &
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=mock npx next dev &
 *   node scripts/smokeInterview.mjs
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const MAX = Number(process.env.SMOKE_TURNS ?? 32);

const ANSWERS = [
  "去年、部署でトラブルが続いたときの話です。みんなは効率の問題だと言っていましたが、自分には信頼の問題に見えました。会議の形を変える案を出し、反対されましたが最後は自分の判断で進めました。",
  "最初の二か月はむしろ混乱しました。失敗だと言われましたが、記録に残して次の判断に使っています。合わないと分かった時点で手順を短く作り直しました。",
  "誰にも頼まれていないのに、毎朝三十分だけ前の日の判断を書き出しています。五年ほど続いていて、これが自分の基準を作っていると思います。",
  "以前は人に合わせてばかりで、自分の意見をほとんど言えませんでした。会議でも黙っていることが多かったです。",
  "十年後には、働く場所と暮らす場所が今ほど強く結びつかなくなると思っています。そのほうが選択肢が増えるからです。",
  "同僚と揉めたとき、黙って引くのではなく直接聞きにいきました。気まずかったですが、話さないと進まないと思ったからです。",
  "予算がまったくつかない企画がありました。制約があると分かってから、かえって形が決まったのを覚えています。",
  "自分は締切がないと動かないタイプだと分かっているので、必ず人と約束して外側から締切を作っています。",
  "料理の段取りの考え方を、そのまま仕事の工程管理に持ち込んだことがあります。工程が見えるようになりました。",
  "評価されない作業でも手を抜かないほうです。誰も見ていない部分の作りが荒いと、自分が納得できません。",
  "知らない言葉が出てくると、その場で調べないと気持ち悪くて、関係のない分野まで読んでしまいます。",
  "決めるときは、何を捨てるかを先に決めています。速さを取るなら品質は諦めると割り切ったことがあります。",
];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const start = await post("/api/interview/start");
const sessionId = start.json.session_id;
console.log(`session ${sessionId}`);
console.log(`Q0: ${start.json.first_question}\n`);

let turn = 0;
for (let i = 0; i < MAX; i++) {
  const answer = ANSWERS[i % ANSWERS.length];
  const { status, json } = await post("/api/interview/message", {
    session_id: sessionId,
    message: answer,
  });
  if (status !== 200) {
    console.log(`turn ${i + 1}: HTTP ${status} ${JSON.stringify(json.error)}`);
    break;
  }
  turn = json.turn;
  console.log(
    `turn ${String(json.turn).padStart(2)} progress=${json.progress.toFixed(3)} complete=${json.is_complete}`
  );
  if (json.is_complete) {
    console.log(`\n完了: ${json.result_url}`);
    break;
  }
}

const profile = await (await fetch(`${BASE}/api/profile/${sessionId}`)).json();
const measured = Object.values(profile.elements).filter((e) => e.evidence_count > 0);

console.log(`\n--- final model (turn ${profile.turn}) ---`);
console.log(`evidence:        ${profile.evidence.length}`);
console.log(`elements w/ ev:  ${measured.length}`);
console.log(`contradictions:  ${profile.contradictions.length} (unresolved ${profile.contradictions.filter((c) => c.status === "unresolved").length})`);
console.log(`confidence:      ${profile.diagnosis_confidence.toFixed(4)}`);
console.log(`coverage:        ${profile.coverage.toFixed(3)}`);
console.log(`max diversity:   ${Math.max(0, ...measured.map((e) => e.evidence_diversity)).toFixed(3)}`);
console.log(`max confidence:  ${Math.max(0, ...measured.map((e) => e.confidence)).toFixed(3)}`);
console.log(`score range:     ${Math.min(...measured.map((e) => e.score)).toFixed(1)} – ${Math.max(...measured.map((e) => e.score)).toFixed(1)}`);
console.log(
  `axes NaN check:  ${profile.axis_insights.every((a) => Number.isFinite(a.score) && Number.isFinite(a.confidence)) ? "ok" : "FAILED"}`
);

console.log(`\nturn ${turn} reached.`);
console.log(`result page: ${BASE}/result/${sessionId}`);
