/**
 * Shown while the reading runs.
 *
 * For most sessions this page render *is* the reading — one model call over the
 * whole conversation, which takes long enough that a blank page reads as a
 * hang. Sessions already read skip straight past this.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">あなたが使っていた言葉</h1>
      <p className="mt-4 text-sm text-[color:var(--muted)]">
        対話の全文をまとめて読み取っています。少しお待ちください。
      </p>
      <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[color:var(--accent)]" />
      </div>
    </main>
  );
}
