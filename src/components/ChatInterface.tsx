"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressIndicator from "./ProgressIndicator";

/**
 * §29 — the interview screen.
 *
 * Deliberately shows no scores during the interview: seeing the model update
 * would change what the user says next.
 */

const MAX_CHARS = 4000;
const EARLY_EXIT_MIN_TURNS = 5;

interface Message {
  role: "ai" | "user";
  content: string;
}

interface MessageResponse {
  reply: string;
  turn: number;
  progress: number;
  is_complete: boolean;
  result_url: string | null;
  aborted?: boolean;
  extraction_degraded?: boolean;
  error?: { code: string; message: string };
}

export default function ChatInterface() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [turn, setTurn] = useState(0);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aborted, setAborted] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode double-invocation creating two sessions.
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/interview/start", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error?.message ?? "診断を開始できませんでした。");
          return;
        }
        setSessionId(data.session_id);
        setMessages([{ role: "ai", content: data.first_question }]);
      } catch {
        setError("診断を開始できませんでした。通信環境を確認してください。");
      } finally {
        setStarting(false);
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !sessionId || aborted) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/interview/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      const data: MessageResponse = await res.json();

      if (!res.ok) {
        setError(data?.error?.message ?? "送信に失敗しました。");
        return;
      }

      setMessages((prev) => [...prev, { role: "ai", content: data.reply }]);
      setTurn(data.turn);
      setProgress(data.progress);
      setDegraded(Boolean(data.extraction_degraded));

      if (data.aborted) {
        setAborted(true);
        return;
      }
      if (data.is_complete && data.result_url) {
        setTimeout(() => router.push(data.result_url!), 1800);
      }
    } catch {
      setError("送信に失敗しました。通信環境を確認してください。");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const overLimit = input.length > MAX_CHARS;
  const canExitEarly = turn >= EARLY_EXIT_MIN_TURNS && !aborted;

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4 py-6">
      <header className="shrink-0 pb-4">
        <ProgressIndicator progress={progress} turn={turn} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {starting && <p className="text-sm text-[color:var(--muted)]">診断を準備しています…</p>}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[color:var(--accent)] px-4 py-3 text-[#08111b]"
                  : "max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3"
              }
            >
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted)]">
              回答を読み取っています…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mt-3 shrink-0 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {/*
        §29 keeps the model hidden during the interview, and this stays on the
        right side of that line: it reports that the reading step is failing,
        never what was read. Staying silent here is what let a broken pipeline
        look like a normal conversation.
      */}
      {degraded && !aborted && (
        <p className="mt-3 shrink-0 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          システム側で読み取りが続けて失敗しています。あなたの回答の問題ではありません。このまま会話は続けられますが、結果に反映されない可能性があります。
        </p>
      )}

      {aborted ? (
        <div className="mt-4 shrink-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-sm text-[color:var(--muted)]">
          今回は診断を中断しました。結果の表示は行いません。
        </div>
      ) : (
        <div className="mt-4 shrink-0">
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={sending || starting || !sessionId}
              placeholder="思い出したことを、そのまま書いてください。Enterで送信 / Shift+Enterで改行"
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-[color:var(--muted)] disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-2 pb-1">
              <span
                className={
                  overLimit ? "text-xs text-red-300" : "text-xs text-[color:var(--muted)]"
                }
              >
                {input.length} / {MAX_CHARS}
              </span>
              <button
                onClick={() => void send()}
                disabled={sending || starting || !input.trim() || overLimit}
                className="rounded-lg bg-[color:var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#08111b] transition disabled:opacity-40"
              >
                送信
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[color:var(--muted)]">
            <span>この診断は医学的・心理学的な診断ではありません。</span>
            {canExitEarly && sessionId && (
              <button
                onClick={() => router.push(`/result/${sessionId}`)}
                className="underline underline-offset-4 hover:text-[color:var(--foreground)]"
              >
                診断を中断して現時点の結果を見る
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
