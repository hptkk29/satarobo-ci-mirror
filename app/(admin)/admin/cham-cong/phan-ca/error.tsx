"use client";

// Màn lỗi của lưới phân ca. Đường lui là Bảng công ngày (màn liền kề trong module), KHÔNG phải
// dashboard: lỗi ở đây thường do một khối/kỳ cụ thể, người dùng cần quay lại chỗ gần nhất để đổi
// phạm vi rồi thử tiếp. Ô đã lưu không mất — mọi thay đổi ghi ngay từng ô.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function PhanCaError({
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
      what="lưới phân ca"
      backHref="/cham-cong"
      backLabel="Về bảng công ngày"
    />
  );
}
