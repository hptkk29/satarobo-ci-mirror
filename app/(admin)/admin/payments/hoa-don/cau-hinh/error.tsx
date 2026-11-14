"use client";

import { LoiKhuVuc } from "../_components/loi-khu-vuc";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LoiKhuVuc
      error={error}
      reset={reset}
      tieuDe="Không tải được cấu hình hoá đơn"
      moTa="Máy chủ báo lỗi khi đọc pháp nhân và ký hiệu của cơ sở. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật."
    />
  );
}
