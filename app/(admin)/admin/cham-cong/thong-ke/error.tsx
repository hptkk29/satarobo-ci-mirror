"use client";

// Màn thống kê vỡ thì nói rõ: đây là màn CHỈ ĐỌC, không có số nào của ai bị ảnh hưởng.
//
// Vì sao cần nói: màn mang chữ "% trừ nội quy" nên lỗi ở đây dễ bị hiểu là "hệ thống vừa trừ
// nhầm của tôi". Nó không ghi gì cả — mọi kết luận nghỉ không phép đều do người bấm ở bảng
// công ngày.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="thống kê nội quy — màn chỉ đọc, không số nào bị đổi"
      backHref="/cham-cong/ky-cong"
      backLabel="Sang màn Kỳ công"
    />
  );
}
