"use client";

// US-10 AC1/AC2/AC4 — nút "Gửi thông báo" + form riêng + bảng "Đã đọc X/Y" ngay sau khi gửi.
//
// ⚠️ NÚT NÀY KHÔNG TỰ QUYẾT ĐỊNH MÌNH CÓ ĐƯỢC HIỆN HAY KHÔNG. Trang cha (Server
// Component) hỏi `checkPermission("chat:announce", { classId, centerId })` rồi mới render;
// và `sendAnnouncement` phía server kiểm lại lần nữa bằng `can()` với target đọc từ DB.
// Ẩn nút chỉ là phép lịch sự với người dùng — không phải hàng rào.
//
// Quota 10 thông báo/ngày/lớp (AC2) do server chặn, kèm câu gợi ý gộp nội dung; ở đây
// chỉ hiển thị nguyên văn thông điệp đó.

import { useState, useTransition } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AnnouncementReadStats } from "./announcement-read-stats";
import { sendStaffAnnouncement } from "./_actions";
import type { StaffChatMessage } from "./types";

/** Trần độ dài — khớp `ANNOUNCEMENT_BODY_MAX` của lib/chat/announcements.ts. */
const BODY_MAX = 4000;

export function AnnouncementComposer({
  conversationId,
  disabled,
  onSent,
}: {
  conversationId: string;
  /** Hội thoại ARCHIVED/LOCKED → không gửi được (server cũng chặn). */
  disabled?: boolean;
  /** Đưa thông báo vừa gửi vào luồng đang mở (khử trùng chung ở chat-store). */
  onSent: (message: StaffChatMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Id thông báo vừa gửi — chuyển dialog sang màn "đã đọc X/Y". */
  const [sentId, setSentId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setBody("");
      setError(null);
      setSentId(null);
    }
    setOpen(next);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await sendStaffAnnouncement({ conversationId, body });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      toast.success("Đã gửi thông báo tới nhóm lớp.");
      onSent({
        id: res.data.id,
        conversationId: res.data.conversationId,
        kind: "ANNOUNCEMENT",
        senderId: res.data.senderId,
        body: res.data.body,
        deleted: false,
        replyToId: null,
        clientMsgId: null,
        createdAt: res.data.createdAt,
      });
      setSentId(res.data.id);
      setBody("");
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="gap-1.5"
      >
        <Megaphone className="h-4 w-4" aria-hidden />
        Gửi thông báo
      </Button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-orange-600" aria-hidden />
              {sentId ? "Đã gửi thông báo" : "Gửi thông báo cho nhóm lớp"}
            </DialogTitle>
            <DialogDescription>
              {sentId
                ? "Thông báo được ghim trên cùng luồng. Bảng dưới đây cho biết phụ huynh nào đã đọc."
                : "Thông báo được ghim trên cùng luồng và báo tới mọi phụ huynh. Tối đa 10 thông báo mỗi ngày cho một lớp."}
            </DialogDescription>
          </DialogHeader>

          {sentId ? (
            <AnnouncementReadStats messageId={sentId} className="rounded-lg border border-border p-3" />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="chat-announcement-body" className="text-xs">
                Nội dung thông báo
              </Label>
              <Textarea
                id="chat-announcement-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Ví dụ: Buổi 8 tuần này lớp mang theo bộ kit đã phát. Phụ huynh đón bé đúng 17h30 giúp cô."
                rows={5}
                maxLength={BODY_MAX}
                disabled={pending}
              />
              <p className="text-right text-xs text-muted-foreground">
                {body.trim().length}/{BODY_MAX}
              </p>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {sentId ? (
              <Button type="button" onClick={() => close(false)}>
                Đóng
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                  Huỷ
                </Button>
                <Button type="button" onClick={submit} disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Gửi thông báo
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
