"use client";

// app/(admin)/admin/cham-cong/error.tsx — bảng công ngày hỏng giữa chừng.
//
// Đường về là màn Kỳ công (không phải dashboard): người đang rà công một ngày thì việc kế tiếp của
// họ nằm ở kỳ đó, và số đã chốt ở kỳ vẫn còn nguyên dù màn này không đọc được.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="bảng công ngày"
      backHref="/cham-cong/ky-cong"
      backLabel="Sang màn Kỳ công"
    />
  );
}
