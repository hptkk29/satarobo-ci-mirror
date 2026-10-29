"use client";

// US-15 — hồ sơ hội thoại + tra cứu có lý do + khoá/mở khoá (F-AUDIT, F-LOCK).
//
// ⚠️ CỐ Ý KHÔNG CHẶN Ở CLIENT (cùng lý lẽ đã ghi ở `delete-message-dialog.tsx`): nút
// "Xem nội dung" luôn bấm được kể cả khi ô lý do trống. Luật "phải có lý do" là của
// SERVER (zod trong `lib/chat/admin.ts` → VALIDATION + `field: "reason"`), và modal này
// KHÔNG phải chốt chặn — AC1 đòi "không route/API nào vòng qua được". Client tự chặn thì
// ta mất chốt kiểm chứng duy nhất rằng luật server còn sống.
//
// ⚠️ Nội dung tin KHÔNG được RSC render sẵn — nó chỉ tới từ Server Action sau khi lý do
// đi qua zod và AuditLog đã ghi xong. Đừng "tối ưu" bằng cách tải sẵn ở page.tsx.
//
// UI: shadcn/ui thuần (admin cấm Magic UI / Framer Motion — .claude/rules/admin-site.md).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  Loader2,
  Lock,
  LockOpen,
  Megaphone,
  MessageSquare,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  adminLookupConversationAction,
  setConversationLockAction,
} from "@/lib/chat/_actions";

/**
 * Khai lại hình dạng dữ liệu thay vì `import type` từ `lib/chat/admin.ts` — file đó import
 * `@/lib/db`; `import type` bị xoá lúc biên dịch nên về lý thuyết an toàn, nhưng chỉ cần
 * một lần ai đó đổi thành import giá trị là kéo cả Prisma vào bundle client (đúng tiền lệ
 * `components/chat/staff/types.ts`).
 */
type TranscriptMessage = {
  id: string;
  kind: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  deleted: boolean;
  deletedAt: Date | string | null;
  deletedReason: string | null;
  attachmentCount: number;
  createdAt: Date | string;
};

const timeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmt(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

const TYPE_LABEL: Record<string, string> = {
  CLASS_GROUP: "Nhóm lớp",
  DM_TEACHER_PARENT: "Hội thoại riêng giáo viên ↔ phụ huynh",
  DM_SALE_PARENT: "Hội thoại riêng Sale ↔ phụ huynh",
  DM_STAFF: "Hội thoại riêng nội bộ",
};

export type AdminConversationViewerProps = {
  conversationId: string;
  displayName: string;
  type: string;
  initialStatus: string;
  centerName: string | null;
  participantCount: number;
  messageCount: number;
  lastMessageAt: Date | string | null;
};

export function AdminConversationViewer(props: AdminConversationViewerProps) {
  const router = useRouter();

  const [status, setStatus] = useState(props.initialStatus);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Lý do ĐÃ được server chấp nhận — dùng lại cho những lần "xem thêm" tiếp theo. */
  const [openedReason, setOpenedReason] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [auditLogId, setAuditLogId] = useState<string | null>(null);

  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);

  const locked = status === "LOCKED";
  const archived = status === "ARCHIVED";

  function runLookup(useReason: string, nextCursor: string | null) {
    startTransition(async () => {
      const res = await adminLookupConversationAction({
        conversationId: props.conversationId,
        reason: useReason,
        cursor: nextCursor,
      });
      if (!res.ok) {
        if (res.error.field === "reason") {
          setReasonError(res.error.message);
          return;
        }
        toast.error(res.error.message);
        return;
      }
      // Lần đầu thay danh sách, "xem thêm" thì NỐI vào cuối (trang chạy MỚI → CŨ).
      setMessages((prev) =>
        nextCursor ? [...(prev ?? []), ...res.data.messages] : res.data.messages,
      );
      setCursor(res.data.nextCursor);
      setHasMore(res.data.hasMore);
      setAuditLogId(res.data.auditLogId);
      setStatus(res.data.conversation.status);
      setOpenedReason(useReason);
      setReasonOpen(false);
      setReasonError(null);
    });
  }

  function submitLock(nextLocked: boolean) {
    setLockError(null);
    startTransition(async () => {
      const res = await setConversationLockAction({
        conversationId: props.conversationId,
        locked: nextLocked,
        reason: lockReason,
      });
      if (!res.ok) {
        if (res.error.field === "reason") {
          setLockError(res.error.message);
          return;
        }
        toast.error(res.error.message);
        return;
      }
      setStatus(res.data.status);
      setLockOpen(false);
      setLockReason("");
      toast.success(
        res.data.changed
          ? nextLocked
            ? "Đã khoá hội thoại. Người đang mở thấy ô nhập vô hiệu ngay."
            : "Đã mở khoá hội thoại."
          : "Hội thoại vốn đã ở trạng thái này.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Hồ sơ */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-foreground">{props.displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {TYPE_LABEL[props.type] ?? props.type}
              {props.centerName ? ` · ${props.centerName}` : ""}
              {` · ${props.participantCount} thành viên · ${props.messageCount} tin`}
              {props.lastMessageAt ? ` · hoạt động cuối ${fmt(props.lastMessageAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {locked ? (
              <Badge variant="destructive">Đang khoá</Badge>
            ) : archived ? (
              <Badge variant="secondary">Đã lưu trữ</Badge>
            ) : (
              <Badge variant="outline">Đang hoạt động</Badge>
            )}
            {/* Hội thoại đã lưu trữ vốn đã không gửi tin được ⇒ không có nút khoá
                (server cũng từ chối — xem `applyLock` trong lib/chat/admin.ts). */}
            {!archived && (
              <Button
                type="button"
                variant={locked ? "outline" : "destructive"}
                size="sm"
                onClick={() => {
                  setLockError(null);
                  setLockOpen(true);
                }}
                disabled={pending}
              >
                {locked ? (
                  <>
                    <LockOpen className="h-4 w-4" aria-hidden /> Mở khoá
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden /> Khoá hội thoại
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Nội dung — chỉ hiện sau khi server chấp nhận lý do */}
      {messages === null ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-state-warning-ink" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">
            Nội dung hội thoại đang đóng
          </p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Đây là hội thoại riêng của giáo viên và phụ huynh. Mở nội dung là một hành động
            được ghi vết: hệ thống lưu lại tên bạn, thời điểm, hội thoại và lý do bạn nhập —
            trước khi hiện bất kỳ dòng tin nào.
          </p>
          <Button
            type="button"
            className="mt-4"
            onClick={() => {
              setReasonError(null);
              setReasonOpen(true);
            }}
            disabled={pending}
          >
            <Eye className="h-4 w-4" aria-hidden /> Xem nội dung (nhập lý do)
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Nội dung hội thoại (mới nhất trước)
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lượt xem này đã được ghi nhật ký
              {auditLogId ? ` (AuditLog ${auditLogId})` : ""}. Lý do đã lưu: “
              {openedReason}”.
            </p>
          </div>

          {messages.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Hội thoại chưa có tin nhắn nào.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {messages.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {m.kind === "ANNOUNCEMENT" ? (
                      <Megaphone className="h-3.5 w-3.5 text-primary" aria-hidden />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span className="font-medium text-foreground">
                      {m.senderName ?? (m.kind === "SYSTEM" ? "Hệ thống" : "Người dùng đã xoá")}
                    </span>
                    <span>{fmt(m.createdAt)}</span>
                    {m.attachmentCount > 0 && <span>· {m.attachmentCount} ảnh</span>}
                    {m.deleted && (
                      <Badge variant="secondary" className="gap-1">
                        <Trash2 className="h-3 w-3" aria-hidden /> đã gỡ
                      </Badge>
                    )}
                  </div>
                  {/* Tin đã gỡ vẫn hiện NGUYÊN VĂN ở màn này — đó chính là lý do US-12
                      giữ `body` trong DB ("để đối chất khi có khiếu nại"), và người đối
                      chất là người đang đứng đây, sau khi đã nhập lý do + bị ghi vết. */}
                  <p
                    className={cn(
                      "mt-1 whitespace-pre-wrap text-sm",
                      m.deleted ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {m.body}
                  </p>
                  {m.deleted && m.deletedReason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Lý do gỡ: {m.deletedReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="border-t border-border p-3 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || !openedReason}
                onClick={() => openedReason && runLookup(openedReason, cursor)}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Xem thêm tin cũ hơn
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Mỗi lần xem thêm là một lượt xem — ghi thêm một dòng nhật ký với cùng lý do.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal lý do (AC1) */}
      <Dialog open={reasonOpen} onOpenChange={(o) => !pending && setReasonOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-state-warning-ink" aria-hidden />
              Lý do xem nội dung
            </DialogTitle>
            <DialogDescription>
              Lý do được lưu nguyên văn vào nhật ký cùng tên bạn và thời điểm. Ghi đủ để
              người khác đọc lại sau vài tháng vẫn hiểu vì sao hội thoại này bị mở.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="chat-admin-reason" className="text-xs">
              Lý do
            </Label>
            <Textarea
              id="chat-admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: xử lý khiếu nại số 128 của phụ huynh lớp Sata 3 ngày 09/08"
              rows={3}
              disabled={pending}
              aria-invalid={reasonError ? true : undefined}
              className={cn(reasonError && "border-destructive")}
            />
            {reasonError && (
              <p role="alert" className="text-xs text-destructive">
                {reasonError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReasonOpen(false)}
              disabled={pending}
            >
              Huỷ
            </Button>
            <Button type="button" onClick={() => runLookup(reason, null)} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Xem nội dung
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal khoá / mở khoá (AC3) */}
      <Dialog open={lockOpen} onOpenChange={(o) => !pending && setLockOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {locked ? (
                <LockOpen className="h-5 w-5 text-state-success-ink" aria-hidden />
              ) : (
                <Lock className="h-5 w-5 text-destructive" aria-hidden />
              )}
              {locked ? "Mở khoá hội thoại" : "Khoá hội thoại"}
            </DialogTitle>
            <DialogDescription>
              {locked
                ? "Mọi thành viên gửi tin lại được ngay; người đang mở thấy ô nhập bật lại mà không cần tải lại trang."
                : "Mọi thành viên (kể cả giáo viên) không gửi được tin mới; lịch sử vẫn đọc được. Người đang mở thấy ô nhập vô hiệu ngay."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="chat-lock-reason" className="text-xs">
              Lý do
            </Label>
            <Textarea
              id="chat-lock-reason"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder={
                locked
                  ? "Ví dụ: đã xử lý xong khiếu nại, mở lại cho lớp trao đổi"
                  : "Ví dụ: tạm khoá do tranh cãi trong nhóm, chờ ban giám hiệu làm việc"
              }
              rows={3}
              disabled={pending}
              aria-invalid={lockError ? true : undefined}
              className={cn(lockError && "border-destructive")}
            />
            {lockError && (
              <p role="alert" className="text-xs text-destructive">
                {lockError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLockOpen(false)}
              disabled={pending}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              variant={locked ? "default" : "destructive"}
              onClick={() => submitLock(!locked)}
              disabled={pending}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {locked ? "Mở khoá" : "Khoá hội thoại"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
