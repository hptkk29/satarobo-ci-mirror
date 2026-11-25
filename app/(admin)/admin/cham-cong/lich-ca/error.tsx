"use client";

// Lỗi khi đọc lịch ca của chính mình. Đường về là Bảng điều khiển: người dùng màn này là NHÂN VIÊN
// thường, không phải Quản lý — đá họ sang màn quản lý chấm công là đưa vào một trang họ không có quyền.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="lịch ca của bạn"
      backHref="/dashboard"
      backLabel="Về bảng điều khiển"
    />
  );
}
