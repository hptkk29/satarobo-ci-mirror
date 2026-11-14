"use client";

// US-16 AC2 — màn chính sách chặn trước cửa chat. MỘT màn hình, tiếng Việt.
//
// Đây CHỈ là lớp hiển thị + nút bấm. Cổng thật nằm ở server (`layout.tsx` của segment và
// từng page tự kiểm `hasAcceptedChatPolicy`) — sửa DOM hay gọi thẳng route đều không lấy
// được một chữ nội dung hội thoại nào.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
// `policy-content` chứ KHÔNG phải `policy`: file kia import `@/lib/db`, kéo vào đây là
// Prisma đi thẳng vào bundle client.
import {
  CHAT_POLICY,
  CHAT_POLICY_FOOTER,
  CHAT_POLICY_TITLE,
} from "@/lib/chat/policy-content";
import { acceptChatPolicyAction } from "@/app/(portal)/portal/tin-nhan/actions";

export function ChatPolicyGate() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function accept() {
    start(async () => {
      const res = await acceptChatPolicyAction();
      if (res.ok) {
        // `refresh` chứ không `push`: người dùng đang đứng ở đúng URL họ muốn vào
        // (có thể là một hội thoại cụ thể) — dựng lại cây RSC là nội dung hiện ra tại chỗ.
        router.refresh();
      } else {
        toast.error(
          res.error ?? "Không ghi nhận được đồng ý, vui lòng thử lại",
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
          aria-hidden
        >
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground">
            {CHAT_POLICY_TITLE}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Vui lòng đọc trước khi vào nhóm lớp của con.
          </p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {CHAT_POLICY.map((item) => (
          <li
            key={item.heading}
            className="rounded-xl border border-border bg-card p-3"
          >
            <p className="text-sm font-semibold text-foreground">
              {item.heading}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {item.body}
            </p>
          </li>
        ))}
      </ul>

      <p className="rounded-xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        {CHAT_POLICY_FOOTER}
      </p>

      <Button
        type="button"
        onClick={accept}
        disabled={pending}
        className="min-h-11 w-full"
        size="lg"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Tôi đã đọc và đồng ý
      </Button>
    </div>
  );
}
