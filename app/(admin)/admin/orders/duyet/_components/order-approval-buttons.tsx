"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveOrderAction, rejectOrderAction } from "../_actions";

/**
 * Cặp nút "Duyệt đơn" / "Từ chối" — MỘT nút cho cả giảm giá lẫn kế hoạch thanh toán
 * (chốt 20/08/2026).
 *
 * Dùng chung ở hai nơi: trang duyệt hàng loạt (/orders/duyet) và khối duyệt trong
 * chi tiết đơn. Hai màn hình phải bấm ra cùng một kết quả — tách hai bản là cách
 * chắc chắn để một bên quên mất phần nào đó sau vài lần sửa.
 *
 * Ô lý do là khối bung ra tại chỗ chứ không phải hộp thoại: ở trang duyệt hàng loạt,
 * người duyệt cần vẫn nhìn thấy đơn mình đang bác trong lúc gõ lý do.
 */
export function OrderApprovalButtons({
  orderId,
  size = "sm",
  tranNgang = false,
}: {
  orderId: string;
  /**
   * `lg` = cao 44px — mức TỐI THIỂU cho ngón tay (`adapt.md`). Mặc định `sm` (36px) chỉ
   * dùng được với chuột; đo 25/09 thấy màn duyệt cũ đang ở 36px, tức dưới chuẩn cảm ứng.
   */
  size?: "sm" | "default" | "lg";
  /** Nút giãn hết bề ngang — cho thanh hành động dính đáy trên điện thoại. */
  tranNgang?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  function handleApprove() {
    startTransition(async () => {
      const res = await approveOrderAction(orderId);
      if (res.ok) {
        toast.success("Đã duyệt đơn");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function handleReject() {
    if (!reason.trim()) {
      toast.error("Nhập lý do từ chối");
      return;
    }
    startTransition(async () => {
      const res = await rejectOrderAction(orderId, reason.trim());
      if (res.ok) {
        toast.success("Đã từ chối đơn");
        setRejectOpen(false);
        setReason("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <div className="space-y-2">
      <div className={tranNgang ? "flex gap-2" : "flex flex-wrap gap-2"}>
        {/* ⚠️ Thứ tự cố ý: DUYỆT trước, TỪ CHỐI sau — nhưng khi tràn ngang thì Duyệt
            chiếm phần lớn hơn. Trên điện thoại, hai nút bằng nhau cạnh nhau là công thức
            bấm nhầm; hành động thường dùng phải to hơn rõ rệt. */}
        <Button
          size={size}
          onClick={handleApprove}
          disabled={isPending}
          className={tranNgang ? "flex-[2]" : undefined}
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Duyệt đơn
        </Button>
        <Button
          size={size}
          variant="outline"
          onClick={() => setRejectOpen((v) => !v)}
          disabled={isPending}
          className={tranNgang ? "flex-1" : undefined}
        >
          Từ chối
        </Button>
      </div>

      {rejectOpen && (
        <div className="space-y-2 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3">
          <label
            className="text-sm font-medium text-state-danger-ink"
            htmlFor={`reject-${orderId}`}
          >
            Lý do từ chối (bắt buộc):
          </label>
          <Textarea
            id={`reject-${orderId}`}
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setReason(e.target.value)
            }
            rows={2}
            placeholder="VD: giảm vượt khung ưu đãi, cần giải trình rõ hơn"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !reason.trim()}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận từ chối
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Huỷ
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
