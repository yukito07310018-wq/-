import { CHECK_LABELS, type HealthReport } from "./health";

/**
 * The health check as a page a non-developer can act on.
 *
 * JSON answers "what is broken" only to someone who already knows the codebase.
 * The person who can actually fix a Vercel environment variable may never have
 * opened this repository, so the same result is rendered as a verdict plus
 * numbered steps. The JSON stays available for scripts (?format=json).
 *
 * Self-contained: inline CSS only, no external requests.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Makes bare URLs in a step clickable without trusting the rest of the string. */
function linkify(text: string): string {
  return escapeHtml(text).replace(
    /https?:\/\/[^\s、。）]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

export function renderHealthPage(report: HealthReport): string {
  const verdict = report.ok
    ? {
        title: "診断は正常に動く状態です",
        body: "AIへの接続・データベースともに問題ありません。結果が「情報不足」になる場合は、システムではなく会話の内容量が原因です。",
        tone: "ok",
      }
    : {
        title: "診断が根拠を集められない状態です",
        body: "この状態では、会話は普通に進むのに結果画面が毎回「情報不足」になります。利用者の回答の問題ではありません。下の手順で直してください。",
        tone: "ng",
      };

  const rows = Object.entries(report.checks)
    .map(([name, check]) => {
      const label = CHECK_LABELS[name] ?? name;
      const mark = check.ok ? "✓" : "✕";
      const cls = check.ok ? "ok" : "ng";
      return `<tr class="${cls}">
        <td class="mark">${mark}</td>
        <td class="label">${escapeHtml(label)}<code>${escapeHtml(name)}</code></td>
        <td class="detail">${escapeHtml(check.detail)}</td>
      </tr>`;
    })
    .join("\n");

  const next = report.nextSteps;
  const steps = next
    ? `<section class="steps${next.optional ? " optional" : ""}">
        <h2>${next.optional ? escapeHtml(next.title) : `次にやること — ${escapeHtml(next.title)}`}</h2>
        ${
          next.optional
            ? `<p class="lead">対話も診断もこのままで動きます。これを行うと、根拠が集まらなかったときに<strong>その原因</strong>が結果画面に出るようになります。急ぎではありません。</p>`
            : ""
        }
        <ol>${next.steps.map((s) => `<li>${linkify(s)}</li>`).join("")}</ol>
        <p class="note">実行したあと、このページを再読み込みしてください。結果は最大30秒キャッシュされます。</p>
      </section>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>システム状態 — AI固有創造性診断</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:2rem 1rem; font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
         line-height:1.7; background:#0d1117; color:#e6edf3; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size:1.35rem; margin:0 0 .5rem; }
  h2 { font-size:1.05rem; margin:0 0 .75rem; }
  .verdict { border-radius:12px; padding:1.25rem; margin-bottom:1.5rem; border:1px solid; }
  .verdict.ok { border-color:#238636; background:rgba(35,134,54,.15); }
  .verdict.ng { border-color:#b62324; background:rgba(182,35,36,.15); }
  .verdict p { margin:.5rem 0 0; font-size:.95rem; }
  table { width:100%; border-collapse:collapse; margin-bottom:1.5rem; font-size:.9rem; }
  td { padding:.6rem .5rem; border-bottom:1px solid #30363d; vertical-align:top; }
  td.mark { width:1.5rem; font-weight:700; }
  tr.ok td.mark { color:#3fb950; }
  tr.ng td.mark { color:#f85149; }
  td.label { width:11rem; }
  td.label code { display:block; font-size:.72rem; opacity:.55; }
  td.detail { opacity:.9; }
  .steps { border:1px solid #30363d; border-radius:12px; padding:1.25rem; background:rgba(255,255,255,.03); }
  .steps.optional { border-style:dashed; opacity:.85; }
  .steps.optional h2 { font-weight:600; opacity:.8; }
  .steps ol { margin:0; padding-left:1.3rem; }
  .steps li { margin-bottom:.6rem; }
  .lead { margin:0 0 1rem; font-size:.88rem; opacity:.8; }
  .note { font-size:.82rem; opacity:.65; margin:1rem 0 0; }
  a { color:#58a6ff; }
  footer { margin-top:2rem; font-size:.78rem; opacity:.55; }
  @media (prefers-color-scheme: light) {
    body { background:#ffffff; color:#1f2328; }
    td { border-bottom-color:#d0d7de; }
    .steps { border-color:#d0d7de; background:#f6f8fa; }
    a { color:#0969da; }
  }
</style>
</head>
<body>
<main>
  <div class="verdict ${verdict.tone}">
    <h1>${escapeHtml(verdict.title)}</h1>
    <p>${escapeHtml(verdict.body)}</p>
  </div>

  <table><tbody>${rows}</tbody></table>

  ${steps}

  <footer>
    このページに APIキーの値は表示されません。機械可読な形式は
    <a href="?format=json">?format=json</a>、上流を呼ばずに設定だけ見るには
    <a href="?probe=0">?probe=0</a> を付けてください。
  </footer>
</main>
</body>
</html>`;
}
