"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * §25/§34.1 — the disclaimer and the delete button.
 *
 * Both are kept exactly as they were while everything above them changed. The
 * app still tells a person things about themselves, so it still has to say what
 * it is not, and they still have to be able to remove everything they typed.
 */

interface Props {
  sessionId: string;
}

export default function SessionActions({ sessionId }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm("この診断のすべてのデータ（会話・引用）を削除します。元に戻せません。")) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "削除に失敗しました。");
        return;
      }
      setDeleted(true);
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setError("削除に失敗しました。通信環境を確認してください。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-5">
      <p className="text-xs leading-relaxed text-[color:var(--muted)]">
        これは、会話の中であなたが実際に使った言葉をそのまま並べたものです。
        人格を医学的・心理学的に診断するものではありませんし、精神疾患の判定でもありません。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        {deleted ? (
          <span className="text-[color:var(--muted)]">削除しました。トップへ戻ります…</span>
        ) : (
          <>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="rounded-lg border border-red-900/60 px-3 py-1.5 text-red-200 transition hover:bg-red-950/40 disabled:opacity-50"
            >
              {deleting ? "削除中…" : "このセッションのデータを削除"}
            </button>
            {error && <span className="text-red-300">{error}</span>}
          </>
        )}
      </div>
    </section>
  );
}
