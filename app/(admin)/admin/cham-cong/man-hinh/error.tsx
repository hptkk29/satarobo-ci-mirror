"use client";

// error.tsx — màn QR quầy hỏng lúc đọc dữ liệu. Đường về là BẢNG CÔNG NGÀY (màn cha, có nút
// "Màn hình QR"), không phải dashboard: người đang đứng ở quầy cần quay lại đúng chỗ họ vừa rời.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function ManHinhError({
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
      what="màn hình QR"
      backHref="/cham-cong"
      backLabel="Về bảng công ngày"
    />
  );
}
