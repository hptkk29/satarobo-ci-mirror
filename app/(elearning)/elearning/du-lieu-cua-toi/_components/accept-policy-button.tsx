"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  const router = useRouter();
  const [dangGui, chuyen] = useTransition();
  const [xong, setXong] = useState(false);

  if (xong) {
    // ⚠️ KHÔNG bảo người dùng "tải lại trang". Bản trước dừng ở đúng câu đó, và vì
    // không `refresh()` nên đoạn văn phía trên — do máy chủ dựng — vẫn còn nguyên
    // câu "Bạn chưa xác nhận bản nào". Màn hình tự cãi nhau: một dòng nói chưa, dòng
    // ngay dưới nói rồi. E2E chụp được đúng cảnh đó.
    //
    // Và họ tới đây vì bị CHẶN giữa chừng khi đang học, nên phải trả họ về chỗ học,
    // đừng để họ tự tìm đường lần thứ hai.
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-state-success-ink">
          ✓ Đã xác nhận. Bạn học tiếp được rồi.
        </p>
        <Link
          href="/elearning"
          className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm"
        >
          Về khoá của tôi
        </Link>
      </div>
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
              // Dựng lại phần máy chủ: đoạn "Bạn chưa xác nhận bản nào" ở trên là
              // RSC, không tự đổi theo state của nút này.
              router.refresh();
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
