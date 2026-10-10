"use client";

// US-13 AC1 — nút "Nhắn riêng" dùng CHUNG cho cả hai chiều:
//   • phía phụ huynh: đứng cạnh tên GIÁO VIÊN trong danh sách thành viên nhóm lớp;
//   • phía nhân viên (admin + site GV): đứng cạnh tên PHỤ HUYNH trong cùng danh sách.
//
// ⚠️ Nút này KHÔNG phải chốt chặn. Ai hiện/ẩn nút chỉ là UX; `openDm` tự kiểm quyền
// (`can()` với target) + kiểm quan hệ dạy học ở server, nên gọi thẳng action mà không
// qua nút vẫn bị chặn y hệt.
//
// Hai site có kiểu URL hội thoại khác nhau (portal đi theo path, màn nhân viên đi theo
// query `?c=`), nên nhận `hrefTemplate` với chỗ trống `:id` — không truyền hàm qua biên
// RSC → Client được.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openDmAction } from "@/lib/chat/_actions";

export function OpenDmButton({
  peerUserId,
  hrefTemplate,
  label = "Nhắn riêng",
  kind = "TEACHER_PARENT",
}: {
  /** `User.id` của người còn lại. */
  peerUserId: string;
  /** Vd `"/portal/tin-nhan/:id"` hoặc `"/tin-nhan?c=:id"`. */
  hrefTemplate: string;
  label?: string;
  /**
   * F5 — kênh muốn mở. MẶC ĐỊNH `TEACHER_PARENT` để hai call-site cũ (thành viên nhóm
   * lớp phía phụ huynh + phía nhân viên) không phải đổi một dòng nào.
   *
   * ⚠️ Union viết bằng chữ TRỰC TIẾP, KHÔNG `import { DmKind } from "@/lib/chat/dm"`:
   * đây là Client Component, mà `dm.ts` import `@/lib/db` (Prisma) + `@/lib/audit` ⇒
   * import value từ đó là kéo module server vào bundle client.
   *
   * ⚠️ Quên truyền `kind="SALE_PARENT"` ở lối vào của sale thì `extractDmKind` rơi về
   * mặc định ⇒ server đi tra QUAN HỆ DẠY HỌC ⇒ luôn PERMISSION_DENIED, mà thông báo lại
   * là "Chỉ nhắn riêng được giữa giáo viên và phụ huynh của lớp đang học" — sai hẳn
   * hướng, rất tốn thời gian truy.
   */
  kind?: "TEACHER_PARENT" | "SALE_PARENT";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function open() {
    if (pending) return;
    setPending(true);
    void (async () => {
      try {
        const res = await openDmAction({ peerUserId, kind });
        if (!res.ok) {
          toast.error(res.error.message);
          setPending(false);
          return;
        }
        // Giữ `pending` = true qua lúc điều hướng: bấm thêm lần nữa trong khi router
        // đang chuyển trang chỉ tạo thêm một lời gọi thừa (server vẫn trả cùng 1 hội
        // thoại nhờ unique dmKey, nhưng không việc gì phải gọi).
        //
        // ⚠️ KHÔNG gọi `router.refresh()` sau `push()` — ĐO ĐƯỢC 10/08/2026 khi nghiệm
        // thu F5 trên test.satarobo.vn: bấm nút ở `/admin/enrollments`, Server Action trả
        // `{ok:true, conversationId}`, RSC của trang đích được fetch và trả **200**, mà
        // KHÔNG có sự kiện điều hướng nào — router lấy payload rồi bỏ đó. `refresh()` gọi
        // ngay sau `push()` làm mất chuyến đi đang bay: nó re-fetch route HIỆN TẠI và
        // giành mất lượt commit. Người dùng thấy nút như CHẾT trong khi hội thoại đã tạo
        // xong trong DB — không toast, không lỗi, không dấu vết trong log server.
        //
        // Trang đích tự dựng mới ở server mỗi lượt vào nên không cần refresh: `push` đã
        // kéo về payload RSC mới nhất.
        router.push(hrefTemplate.replace(":id", res.data.conversationId));
      } catch {
        toast.error("Không mở được hội thoại riêng — vui lòng thử lại.");
        setPending(false);
      }
    })();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={open}
      disabled={pending}
      className="h-9 shrink-0 gap-1.5 text-xs"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <MessageSquare className="size-3.5" aria-hidden />
      )}
      {label}
    </Button>
  );
}
