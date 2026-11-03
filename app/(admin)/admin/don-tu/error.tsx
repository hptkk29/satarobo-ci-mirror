"use client";

// app/(admin)/admin/don-tu/error.tsx — hỏng khi ĐỌC danh sách đơn.
//
// Đường về là `/dashboard` chứ không phải một màn chấm công: người vào đây có thể chỉ giữ mỗi
// quyền duyệt đơn (không có `hr_attendance:view`), đá họ sang /cham-cong là rơi tiếp vào màn
// "không có quyền". Lỗi ở màn này KHÔNG đụng dữ liệu — mọi quyết định duyệt đi qua Server Action
// riêng, đơn nào chưa bấm thì vẫn nguyên trạng Chờ duyệt.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function DonTuError({
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
      what="danh sách đơn"
      backHref="/dashboard"
      backLabel="Về Tổng quan"
    />
  );
}
