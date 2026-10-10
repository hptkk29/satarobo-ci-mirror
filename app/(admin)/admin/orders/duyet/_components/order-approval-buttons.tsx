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
 * ~~CHỈ còn dùng ở trang duyệt hàng loạt (/orders/duyet — qua `order-approval-card.tsx`)~~
 * **[ĐÍNH CHÍNH khi gộp `test` 01/10/2026]** PR #436 dựng lại cơ chế duyệt: `/orders/duyet` nay chỉ
 * đá về `/orders?duyet=1`, và component này dùng ở HAI nơi — thẻ trong khối "Chờ duyệt" của danh
 * sách đơn (`khoi-cho-duyet.tsx` → `order-approval-card.tsx`) và thanh nút của màn duyệt một đơn
 * (`/orders/[id]/duyet`). Cả hai đi qua CHÍNH cặp action + toast `thongDiepPhieu` dưới đây.
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
        // Duyệt kế hoạch VOID phiếu "thu toàn đơn" — nằm trong phiếu gộp thì mã của cả nhà vừa
        // bị huỷ/đóng. Nói ra (rà vòng 4, luật 12), không thì phụ huynh quét QR cũ.
        if (res.thongDiepPhieu) toast.warning(res.thongDiepPhieu, { duration: 15_000 });
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
        if (res.thongDiepPhieu) toast.warning(res.thongDiepPhieu, { duration: 15_000 });
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
