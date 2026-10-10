"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { chiaLaiLeadAction } from "../../actions";

/**
 * S-2b (25/08/2026) — Nút này TRƯỚC ĐÂY tên "Chia lại lead" và lần nào bấm cũng
 * báo xanh, kể cả khi không làm gì. Nó gọi `autoAssignNewLead` — hàm CỐ Ý bỏ qua
 * lead đã có người phụ trách — nên trên trang chi tiết lead (nơi lead gần như
 * luôn đã được phân công) nó gần như không bao giờ chia lại được thật.
 *
 * Hai việc đã sửa: (1) đổi tên thành "Chia tự động" cho đúng thứ nó làm — chia
 * lead CHƯA phân công theo cấu hình cơ sở; (2) lead đã có người phụ trách thì làm
 * mờ nút và chỉ sang ô "Gán tay" ngay cạnh, thay vì để người dùng bấm rồi ăn lỗi.
 * Cổng thật vẫn nằm ở server — chỗ này chỉ là để người dùng khỏi bấm hụt.
 */
export function ReassignButton({
  leadId,
  daCoNguoiPhuTrach = false,
}: {
  leadId: string;
  daCoNguoiPhuTrach?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending || daCoNguoiPhuTrach}
      title={
        daCoNguoiPhuTrach
          ? 'Lead đã có người phụ trách — dùng ô "Gán tay" bên cạnh để đổi người.'
          : "Chia lead chưa phân công cho tư vấn viên tới lượt, theo cấu hình cơ sở."
      }
      onClick={() =>
        startTransition(async () => {
          // 03/09 — đổi sang `chiaLaiLeadAction`. Nút cũ gọi `autoAssignNewLeadAction`,
          // vốn dành cho lead MỚI và cố ý bỏ qua lead đã có chủ; nó trả `ok: true`
          // kèm `skipped` nên nút báo thành công trong khi lead không đổi tay.
          const res = await chiaLaiLeadAction(leadId);
          if (res.ok) {
            toast.success("Đã chia lead cho tư vấn viên tới lượt");
            router.refresh();
          } else {
            // Lời nhắn từ server đã nói rõ vì sao không chia được + phải làm gì
            // tiếp. Đừng nuốt nó bằng một câu chung chung.
            toast.error(res.error);
          }
        })
      }
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
      Chia tự động
    </button>
  );
}
