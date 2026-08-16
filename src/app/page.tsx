import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">AI固有創造性診断</h1>

      <p className="mt-8 text-lg leading-relaxed text-[color:var(--muted)]">
        あなたが何度も戻ってくる場所を、
        <br />
        あなた自身の言葉のまま取り出します。
      </p>

      <div className="mt-10 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <h2 className="text-sm font-semibold tracking-wide text-[color:var(--accent)]">
          この診断の仕組み
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-[color:var(--muted)]">
          <li>・AIが薄く広い問いを出し、どの話題を話すかはあなたが選びます。</li>
          <li>・選んだ話題を数ターン掘り下げます。話が尽きたら別の話題へ移ります。</li>
          <li>・対話が終わったあとで、全文をまとめて一度だけ読み取ります。途中では何も判定しません。</li>
          <li>・結果に出るのは、話題ごとの、あなたが実際に使った言葉です。点数はつきません。</li>
          <li>・最大10問。いつでも「ここまでにする」で終われます。</li>
        </ul>
      </div>

      <div className="mt-8">
        <Link
          href="/interview"
          className="inline-flex items-center rounded-lg bg-[color:var(--accent)] px-6 py-3 font-semibold text-[#08111b] transition hover:opacity-90"
        >
          診断を始める
        </Link>
      </div>

      <div className="mt-12 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-6 text-sm text-[color:var(--muted)]">
        <h2 className="font-semibold text-[color:var(--foreground)]">はじめる前に</h2>
        <p className="mt-3">
          この診断は、会話から得られた情報をもとにした暫定的な個人モデルです。
          人格を医学的・心理学的に診断するものではありません。
        </p>
        <p className="mt-3">
          対話では、選択・葛藤・うまくいかなかった経験について尋ねることがあります。
          答えたくない質問には答えなくて構いませんし、いつでも中断できます。
        </p>
        <p className="mt-3">
          回答内容はセッションIDに紐づけて保存されます。結果画面からいつでも全データを削除できます。
        </p>
      </div>
    </main>
  );
}
