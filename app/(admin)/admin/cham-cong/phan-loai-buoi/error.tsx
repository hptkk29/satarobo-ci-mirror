"use client";

// Màn lỗi của Phân loại buổi. Quay lại đúng cụm chấm công (không đá về dashboard) và in mã lỗi để báo
// kỹ thuật — không có mã thì mỗi lần hỏi lại phải dựng lại lỗi.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function PhanLoaiBuoiError({
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
        what="danh mục phân loại buổi"
        backHref="/cham-cong"
        backLabel="Về Chấm công"
      />
    </div>
  );
}
