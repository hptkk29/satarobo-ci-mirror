"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

/**
 * Error boundary cho mọi trang portal phụ huynh (nằm trong
 * app/(portal)/portal/layout.tsx nên shell/nav vẫn giữ). Thay cho màn lỗi
 * generic tiếng Anh của Next khi một RSC văng lỗi không bắt được (vd mất
 * kết nối DB).
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log ra console để dev/Sentry bắt được (Sentry đã cấu hình ở project).
    console.error("[portal] page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h1 className="text-lg font-bold text-neutral-900">Có lỗi xảy ra</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Trang gặp sự cố khi tải dữ liệu. Quý phụ huynh vui lòng thử lại — nếu
          vẫn lỗi, hãy liên hệ trung tâm để được hỗ trợ.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-neutral-600">
            Mã lỗi: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" />
            Thử lại
          </button>
          <a
            href="/portal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Home className="h-4 w-4" />
            Về trang chính
          </a>
        </div>
      </div>
    </div>
  );
}
