"use client";

// Màn công dạy vỡ thì nói rõ: đây là màn ĐẾM, không phải bảng lương, và nó không ghi gì cả.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="công dạy — màn đếm buổi, không phải bảng lương"
      backHref="/cham-cong/ky-cong"
      backLabel="Sang màn Kỳ công"
    />
  );
}
