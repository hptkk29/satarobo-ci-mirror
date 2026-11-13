"use client";

// components/lms/chot-buoi-button.tsx — nút "Chốt buổi", dùng chung admin + site GV (D1).
//
// Vì sao dùng chung: trước D1 chỉ màn admin có nút này, và giáo viên — những người
// THỰC SỰ dạy buổi — không có đường nào bấm (decideRoute đá họ khỏi host admin).
// Kết quả prod 07/09/2026: 2 buổi COMPLETED / 287 SCHEDULED. Nay hai site cùng một
// nút và cùng một cổng (`lib/lms/chot-buoi.ts`), nên không thể trôi khỏi nhau.
//
// ⚠️ Nút bị `disabled` KHÔNG phải là cổng. Server kiểm lại đủ ba việc — Server Action
// là endpoint riêng, POST thẳng vào được.
import { useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ChotBuoiKetQua } from "@/lib/lms/chot-buoi";

export function ChotBuoiButton({
  sessionId,
  daChot,
  sanSang,
  thieu,
  chot,
  onXong,
  size = "sm",
}: {
  sessionId: string;
  /** `ClassSession.status === "COMPLETED"`. Đã chốt thì không hiện nút nữa. */
  daChot: boolean;
  /** Đủ cả ba việc (isSessionWorkComplete). Thiếu thì nút mờ, không bấm được. */
  sanSang: boolean;
  /** Các việc còn thiếu, để hiện trong tooltip. Rỗng khi `sanSang`. */
  thieu: string[];
  /** Server Action của site gọi nó — hai site khác nhau đúng ở `revalidatePath`. */
  chot: (sessionId: string) => Promise<ChotBuoiKetQua>;
  /**
   * Việc phải làm sau khi chốt — thường là `router.refresh()`. BẮT BUỘC, và component
   * cố ý KHÔNG tự gọi `refresh`: caller nào cũng đã có sẵn một đường làm mới của mình,
   * tự gọi thêm là làm mới hai lần cho mỗi lần bấm.
   */
  onXong: () => void;
  size?: "sm" | "default";
}) {
  const [pending, start] = useTransition();

  if (daChot) return null;

  return (
    <Button
      size={size}
      disabled={!sanSang || pending}
      title={
        sanSang ? "Chốt buổi này là đã xong" : `Còn thiếu: ${thieu.join(", ")}`
      }
      onClick={() => {
        start(async () => {
          const res = await chot(sessionId);
          if (!res.ok) {
            toast.error(res.error ?? "Chốt buổi thất bại");
            return;
          }
          toast.success(
            res.alreadyCompleted ? "Buổi này đã chốt từ trước" : "Đã chốt buổi",
          );
          onXong();
        });
      }}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      )}
      Chốt buổi
    </Button>
  );
}
