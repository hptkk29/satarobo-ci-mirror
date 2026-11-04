"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { acceptPolicyAction } from "../../_actions";

/**
 * Nút xác nhận chính sách theo dõi học tập.
 *
 * Câu chữ trên nút và ngay cạnh nút phải nói ĐỦ HỆ QUẢ trước khi bấm — không đẩy
 * xuống một trang trợ giúp. Người bấm "Đồng ý" mà không biết mình đồng ý điều gì
 * thì bản ghi đồng ý đó không có giá trị làm bằng chứng, tức mất đúng thứ nó sinh
 * ra để giữ.
 */
export function AcceptPolicyButton({ version }: { version: string }) {
  const [dangGui, chuyen] = useTransition();
  const [xong, setXong] = useState(false);

  if (xong) {
    return (
      <p className="text-sm font-medium text-state-success-ink">
        ✓ Đã xác nhận. Tải lại trang để xem mốc thời gian.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs">
        Xác nhận nghĩa là bạn đồng ý để hệ thống ghi nhận thời gian và mức độ bạn
        xem từng bài, phục vụ việc chứng minh đã hoàn thành đào tạo. Dữ liệu đo
        hành vi bị xoá sau 90 ngày; chứng từ hoàn thành được giữ dài.
      </p>
      <button
        type="button"
        disabled={dangGui}
        onClick={() =>
          chuyen(async () => {
            const r = await acceptPolicyAction({});
            if (r.ok) {
              setXong(true);
              toast.success("Đã xác nhận chính sách theo dõi học tập");
            } else {
              toast.error(r.error.message);
            }
          })
        }
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {dangGui ? "Đang gửi…" : `Tôi xác nhận bản ${version}`}
      </button>
    </div>
  );
}
