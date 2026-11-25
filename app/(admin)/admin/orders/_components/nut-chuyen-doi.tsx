"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/admin/ui/help-hint";

/**
 * Nút mở màn Chuyển đổi (xếp học viên vào lớp) trên thanh tiêu đề màn chi tiết đơn.
 *
 * ⚠️ KHÔNG ẨN khi chưa đủ điều kiện — hiện nút MỜ kèm lý do. Ẩn là để sale mở đơn ra,
 * không thấy nút, rồi tự đoán: đơn này không chuyển đổi được, hay mình thiếu quyền, hay
 * tính năng hỏng? Luật 12 của repo: affordance phải nói thật, và "không làm được" cũng
 * là một sự thật cần nói ra.
 *
 * ⚠️ `HelpHint` ĐỨNG NGOÀI `Button`, không lồng vào trong — và đây là lỗi đã ĐO ĐƯỢC chứ
 * không phải phòng xa. `HelpHint` render một `<button>` (TooltipTrigger `type="button"`),
 * nên đặt nó bên trong `<Button>` là `<button>` lồng `<button>`: HTML không hợp lệ, và
 * React ném "Hydration failed… Invalid HTML tag nesting" ngay khi mở màn đơn. Bản đầu của
 * tệp này mắc đúng lỗi đó, smoke bắt được.
 */
export function NutChuyenDoi({
  orderId,
  duocChuyenDoi,
  lyDoKhoa,
  soTienWebhook,
}: {
  orderId: string;
  duocChuyenDoi: boolean;
  /** `null` khi đủ điều kiện. */
  lyDoKhoa: string | null;
  soTienWebhook: number;
}) {
  if (!duocChuyenDoi) {
    return (
      <span className="inline-flex items-center gap-1">
        {/* `title` giữ lại cho chuột rê; `HelpHint` là đường cho bàn phím và cho người
            dùng trình đọc màn hình — nút `disabled` không nhận focus nên chỉ có `title`
            là một lời giải thích mà một nửa người dùng không bao giờ đọc được. */}
        <Button variant="outline" disabled title={lyDoKhoa ?? undefined}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Chuyển đổi
        </Button>
        <HelpHint label="Vì sao chưa chuyển đổi được">
          {lyDoKhoa ?? "Chưa đủ điều kiện chuyển đổi."}
        </HelpHint>
      </span>
    );
  }
  return (
    <Button asChild variant="outline">
      <Link href={`/orders/${orderId}/chuyen-doi`}>
        <UserPlus className="h-4 w-4" aria-hidden />
        Chuyển đổi
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
          (đã về {soTienWebhook.toLocaleString("vi-VN")}đ)
        </span>
      </Link>
    </Button>
  );
}
