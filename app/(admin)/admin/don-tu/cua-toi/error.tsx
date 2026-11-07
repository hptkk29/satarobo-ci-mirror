"use client";

// Lỗi khi đọc đơn của chính mình. Về lịch ca (cùng cụm "Của tôi"), không đá sang màn duyệt đơn —
// người dùng màn này thường KHÔNG có quyền `hr_attendance:approve`.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="đơn của bạn"
      backHref="/cham-cong/lich-ca"
      backLabel="Về lịch ca của tôi"
    />
  );
}
