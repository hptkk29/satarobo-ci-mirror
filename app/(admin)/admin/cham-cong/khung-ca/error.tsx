"use client";

// Màn lỗi của Khung ca tuần. Đường lui là Chấm công (màn gốc của cụm), không phải dashboard.
// Ô đã chọn không mất: mỗi ô ghi ngay khi chọn, lỗi ở đây là lỗi lượt ĐỌC lại màn.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function KhungCaError({
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
        what="khung ca tuần"
        backHref="/cham-cong"
        backLabel="Về Chấm công"
      />
    </div>
  );
}
