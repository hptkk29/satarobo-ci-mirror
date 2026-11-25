"use client";

// app/(admin)/admin/cham-cong/phan-ca/import/error.tsx — màn hỏng khi RSC của trang import ném.
//
// Vì sao câu chữ nói "file chưa được áp": lỗi ở tầng này chỉ có thể xảy ra khi DỰNG trang (đọc
// danh sách nhân sự, đọc nhật ký) — chưa có lượt import nào chạy. Người dùng vừa mất một file vừa
// chọn nên phải được nói rõ là hệ thống chưa đổi gì, kẻo họ đi kiểm lưới rồi sửa tay chồng lên.
// Lỗi xảy ra GIỮA lượt áp thì do wizard bắt và hiện tại chỗ, không rơi vào đây.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      {...props}
      what="màn import — file chưa được áp"
      backHref="/cham-cong/phan-ca"
      backLabel="Về lưới phân ca"
    />
  );
}
