"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

/** Lỗi riêng của khu DISC. Không in nội dung lỗi (có thể chứa dữ liệu của trẻ); chỉ mã `digest` để tra log. */
export default function DiscError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
      <AlertTriangle aria-hidden className="mx-auto size-8 text-state-warning-ink" />
      <h1 className="mt-3 text-lg font-bold text-foreground">Chưa tải được kết quả DISC</h1>
      <p className="mt-2 text-sm text-muted-foreground">Quý phụ huynh vui lòng thử lại. Nếu vẫn lỗi, hãy liên hệ trung tâm để được hỗ trợ.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Mã lỗi: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-[color:var(--accent-foreground)] hover:opacity-90"
      >
        <RotateCcw aria-hidden className="size-4" />
        Thử lại
      </button>
    </div>
  );
}
