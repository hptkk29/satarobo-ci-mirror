"use client";

// Lỗi ở màn chấm công. Đường về DUY NHẤT là lịch ca — người đang đứng quầy cần biết ca của mình,
// không cần bảng điều khiển. Cố ý KHÔNG có nút Dashboard ở đây.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="trang chấm công — quét lại mã trên màn hình quầy"
      backHref="/cham-cong/lich-ca"
      backLabel="Về lịch ca của tôi"
    />
  );
}
