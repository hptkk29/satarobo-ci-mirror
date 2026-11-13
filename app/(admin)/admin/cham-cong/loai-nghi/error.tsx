"use client";

// Màn lỗi của Loại nghỉ. Quay lại đúng cụm chấm công (không đá về dashboard) và in mã lỗi để báo
// kỹ thuật — không có mã thì mỗi lần hỏi lại phải dựng lại lỗi.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function LoaiNghiError({
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
        what="danh mục loại nghỉ"
        backHref="/cham-cong"
        backLabel="Về Chấm công"
      />
    </div>
  );
}
