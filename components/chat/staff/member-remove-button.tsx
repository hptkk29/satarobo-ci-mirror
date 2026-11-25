"use client";

// Nút "Gỡ" một thành viên ĐÃ ĐƯỢC THÊM TAY khỏi nhóm lớp (chỉ Admin — `chat:admin`).
//
// ⚠️ Chỉ hiện ở dòng `source = MANUAL`. Thành viên do hệ thống dẫn xuất (GV, PH, QLCS theo cơ sở)
// không có nút này: gỡ họ chỉ có tác dụng tới lần đồng bộ kế tiếp rồi họ lại hiện về — một nút
// nói dối (luật 12). Server vẫn từ chối `NOT_MANUAL_MEMBER` nếu bị gọi thẳng.
//
// Xác nhận hai lần bấm (mẫu của admin: "Confirm-delete pattern: 2-click"): lần một đổi nhãn
// thành "Xác nhận gỡ", lần hai mới gỡ; tự về nhãn cũ sau vài giây để không nằm chờ vô thời hạn.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeManualMemberAction } from "@/lib/chat/_actions";

const CONFIRM_WINDOW_MS = 4_000;

export function MemberRemoveButton({
  conversationId,
  userId,
  name,
}: {
  conversationId: string;
  userId: string;
  name: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function click() {
    if (pending) return;
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    startTransition(async () => {
      const res = await removeManualMemberAction({ conversationId, userId });
      if (!res.ok) {
        toast.error(res.error.message);
        setArmed(false);
        return;
      }
      toast.success(`Đã gỡ ${name} khỏi nhóm.`);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant={armed ? "destructive" : "outline"}
      size="sm"
      onClick={click}
      disabled={pending}
      aria-label={armed ? `Xác nhận gỡ ${name}` : `Gỡ ${name} khỏi nhóm`}
      className="h-9 shrink-0 gap-1.5 text-xs"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <UserMinus className="size-3.5" aria-hidden />
      )}
      {armed ? "Xác nhận gỡ" : "Gỡ"}
    </Button>
  );
}
