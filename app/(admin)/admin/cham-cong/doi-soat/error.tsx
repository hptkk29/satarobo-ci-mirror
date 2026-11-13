"use client";

// error.tsx — màn Đối soát hỏng lúc tải. Đối soát chỉ ĐỌC nên không có việc dở dang nào bị mất;
// đường về là Kỳ công (nơi đọc số đã chốt), không đá người dùng ra dashboard.
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
      what="đối soát"
      backHref="/cham-cong/ky-cong"
      backLabel="Về kỳ công"
    />
  );
}
