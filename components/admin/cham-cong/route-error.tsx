"use client";

// components/admin/cham-cong/route-error.tsx — thân của mọi `error.tsx` trong module.
//
// Vì sao file này tồn tại: `error.tsx` mặc định của Next in một dòng tiếng Anh không nói được
// hỏng cái gì và mất luôn đường quay lại. Ở module này lỗi hay xảy ra giữa chừng một việc nhiều
// bước (đang chốt kỳ, đang áp file import), nên màn lỗi phải nói RÕ MÀN NÀO hỏng + có đường về
// màn liền kề, chứ không đá về dashboard.
//
// `digest` in ra để người dùng đọc cho kỹ thuật — không có nó thì mỗi lần hỏi lại phải dựng lại lỗi.
import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/admin/ui/states";
import { BTN_OUTLINE, BTN_PRIMARY } from "./classes";

export function RouteError({
  error,
  reset,
  what,
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Cụm danh từ ghép vào "Không tải được …" — vd "bảng công ngày". */
  what: string;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={`Không tải được ${what}`}
      description={
        <>
          <p>Máy chủ báo lỗi khi đọc dữ liệu. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật.</p>
          {error.digest && (
            <p className="mt-2">
              Mã lỗi:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {error.digest}
              </code>
            </p>
          )}
        </>
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={reset} className={BTN_PRIMARY}>
            Thử lại
          </button>
          <Link href={backHref} className={BTN_OUTLINE}>
            {backLabel}
          </Link>
        </div>
      }
    />
  );
}
