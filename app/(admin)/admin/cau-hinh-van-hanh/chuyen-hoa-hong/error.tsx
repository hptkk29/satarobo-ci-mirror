"use client";

// Ranh giới lỗi của trang «Chuyển sang hoa hồng mới»: câu tiếng Việt + nút Thử lại + mã lỗi (digest) để đọc cho kỹ thuật. Khung admin vẫn giữ vì nằm trong layout.
import { useEffect } from "react";

import { BTN_OUTLINE } from "@/components/admin/nguon-hoa-hong/classes";
import { ErrorState } from "@/components/admin/ui/states";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-5xl">
      <ErrorState
        title="Không tải được trang chuyển sang hoa hồng mới"
        description={
          <>
            <p>Máy chủ báo lỗi khi đọc mốc hoặc nhật ký. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật.</p>
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
