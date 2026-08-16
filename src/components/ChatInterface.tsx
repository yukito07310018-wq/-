"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressIndicator from "./ProgressIndicator";
import { MAX_TURNS } from "@/lib/engine/terminationEngine";

/**
 * §29 — the interview screen.
 *
 * Deliberately shows nothing about what is being read: seeing it would change
 * what the user says next. Nothing is read during the interview anyway.
 *
 * 「ここまでにする」 is on screen from the first turn. With the reading happening
 * once at the end, a session nobody ends is a session with no output at all, and
 * both real sessions so far ended with the person simply leaving.
 */

const MAX_CHARS = 4000;

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
  const [finishing, setFinishing] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aborted, setAborted] = useState(false);

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
    if (!text || sending || finishing || !sessionId || aborted) return;

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

  /** Ends the interview and reads it. The reading is the only output there is. */
  async function finish() {
    if (!sessionId || sending || finishing) return;
    if (!confirm("ここまでの対話で読み取ります。これ以降は質問を続けられません。")) return;

    setFinishing(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "読み取りに失敗しました。");
        return;
      }
      router.push(data.result_url);
    } catch {
      setError("読み取りに失敗しました。通信環境を確認してください。");
    } finally {
      setFinishing(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const overLimit = input.length > MAX_CHARS;

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4 py-6">
      <header className="shrink-0 pb-4">
        <ProgressIndicator progress={progress} turn={turn} maxTurns={MAX_TURNS} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {starting && <p className="text-sm text-[color:var(--muted)]">対話を準備しています…</p>}

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
              考えています…
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

      {aborted ? (
        <div className="mt-4 shrink-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-sm text-[color:var(--muted)]">
          今回は対話を中断しました。結果の表示は行いません。
        </div>
      ) : (
        <div className="mt-4 shrink-0">
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={sending || finishing || starting || !sessionId}
              placeholder="思い出したことを、そのまま書いてください。Enterで送信 / Shift+Enterで改行"
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-[color:var(--muted)] disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-2 pb-1">
              <span
                className={overLimit ? "text-xs text-red-300" : "text-xs text-[color:var(--muted)]"}
              >
                {input.length} / {MAX_CHARS}
              </span>
              <button
                onClick={() => void send()}
                disabled={sending || finishing || starting || !input.trim() || overLimit}
                className="rounded-lg bg-[color:var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#08111b] transition disabled:opacity-40"
              >
                送信
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted)]">
            <span>この診断は医学的・心理学的な診断ではありません。</span>
            <button
              onClick={() => void finish()}
              disabled={!sessionId || sending || finishing}
              className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 transition hover:text-[color:var(--foreground)] disabled:opacity-40"
            >
              {finishing ? "読み取っています…" : "ここまでにする"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
