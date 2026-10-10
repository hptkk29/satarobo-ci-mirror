"use client";

// Màn lỗi của Mã ca. Không đá về dashboard: người đang khai danh mục cần quay lại đúng cụm chấm
// công, và cần thấy mã lỗi để báo kỹ thuật.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function DanhMucCaError({
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
        what="danh mục mã ca"
        backHref="/cham-cong"
        backLabel="Về Chấm công"
      />
    </div>
  );
}
