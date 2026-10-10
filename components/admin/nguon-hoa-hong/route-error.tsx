"use client";

// components/admin/nguon-hoa-hong/route-error.tsx — thân của `error.tsx` cho module (một ranh giới ở gốc segment).
//
// `error.tsx` mặc định của Next in một dòng tiếng Anh không nói hỏng cái gì và mất luôn đường quay lại. Ở đây:
// câu tiếng Việt + nút Thử lại. `digest` in ra để người dùng đọc cho kỹ thuật — không có nó thì mỗi lần hỏi lại
// phải dựng lại lỗi.
import { useEffect } from "react";
import { ErrorState } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "./classes";

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-6xl">
      <ErrorState
        title="Không tải được màn nguồn lead và hoa hồng"
        description={
          <>
            <p>Máy chủ báo lỗi khi đọc dữ liệu. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật.</p>
            {error.digest && (
              <p className="mt-2">
                Mã lỗi: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{error.digest}</code>
              </p>
            )}
          </>
        }
        action={
          <button type="button" onClick={reset} className={BTN_OUTLINE}>
            Thử lại
          </button>
        }
      />
    </div>
  );
}
