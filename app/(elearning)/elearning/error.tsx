"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/admin/ui/states";

// Lỗi khi tải một trang trong khu học tập: câu tiếng Việt đọc được + đường thử lại + đường về. Thanh bên/thanh trên
// (layout) vẫn dùng được nên người dùng không bị "mắc kẹt".
export default function ElearningError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry đã gắn ở cấp ứng dụng; ở đây chỉ để lại dấu trong console cho người hỗ trợ.
    console.error("[elearning] lỗi tải trang", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <ErrorState
        title="Không tải được trang này"
        description={
          <>
            Có lỗi khi tải dữ liệu. Bạn thử tải lại; nếu vẫn lỗi, báo phòng Đào tạo kèm mã{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {error.digest ?? "không có"}
            </code>
            .
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Thử lại
            </button>
            <Link
              href="/elearning"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Về tổng quan
            </Link>
          </div>
        }
      />
    </div>
  );
}
