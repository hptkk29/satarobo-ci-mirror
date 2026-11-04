"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, LayoutDashboard } from "lucide-react";

/**
 * Error boundary cho mọi trang admin (nằm trong app/(admin)/admin/layout.tsx
 * nên SIDEBAR vẫn giữ). Thay cho màn "server error" trắng trơn của Next khi
 * một RSC/Server Action văng lỗi không bắt được.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log ra console để dev/Sentry bắt được (Sentry đã cấu hình ở project).
    console.error("[admin] page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-state-danger-soft bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-state-danger-soft">
          <AlertTriangle className="h-6 w-6 text-state-danger-ink" />
        </div>
        <h1 className="text-lg font-bold text-foreground">Có lỗi xảy ra</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Trang gặp sự cố khi tải. Bạn có thể thử lại — nếu vẫn lỗi, vui lòng
          chụp màn hình và báo quản trị viên.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Mã lỗi: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" />
            Thử lại
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <LayoutDashboard className="h-4 w-4" />
            Về Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
