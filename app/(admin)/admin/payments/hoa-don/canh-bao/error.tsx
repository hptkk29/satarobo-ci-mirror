"use client";

import { LoiKhuVuc } from "../_components/loi-khu-vuc";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LoiKhuVuc
      error={error}
      reset={reset}
      tieuDe="Không tải được danh sách cảnh báo hoá đơn"
      moTa="Máy chủ báo lỗi khi đọc các lần thu cần xem lại. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật."
    />
  );
}
