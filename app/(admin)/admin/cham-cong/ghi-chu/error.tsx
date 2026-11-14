"use client";

// Màn lỗi của Ghi chú lịch. Ghi chú đã lưu không mất — lỗi ở đây là lỗi lượt ĐỌC lại màn; tin nhắc
// lịch vẫn chạy theo dữ liệu trong cơ sở dữ liệu.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function GhiChuError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-6xl">
      <RouteError
        error={error}
        reset={reset}
        what="ghi chú lịch"
        backHref="/cham-cong"
        backLabel="Về Chấm công"
      />
    </div>
  );
}
