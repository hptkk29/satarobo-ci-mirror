"use client";

// US-10 AC4 — "Đã đọc 12/30" + danh sách ai CHƯA đọc.
//
// Mẫu số chỉ đếm PHỤ HUYNH (`isAnnouncementRecipient` trong lib/chat/announcements.ts):
// GV/QLCS là người GỬI, đếm họ vào thì con số luôn lệch. Payload chỉ có tên hiển thị đã
// qua `redactContactLike` — đây là danh sách để NHẮC, không phải danh bạ (BR-30).
//
// Nút "Làm mới" là bản tối thiểu của "cập nhật không cần reload": không reload TRANG,
// chỉ gọi lại Server Action. (Bản đẩy realtime dùng event `announcement.read` mà server
// đã phát sẵn — việc của đợt sau, xem ghi chú ở markAnnouncementRead.)

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadStaffAnnouncementStats } from "./_actions";
import type { StaffAnnouncementStats } from "./types";

export function AnnouncementReadStats({
  messageId,
  initial,
  className,
}: {
  messageId: string;
  /** Số liệu đã dựng sẵn ở RSC (tab "Thông báo") — bỏ trống thì tự tải khi hiện. */
  initial?: StaffAnnouncementStats;
  className?: string;
}) {
  const [stats, setStats] = useState<StaffAnnouncementStats | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const res = await loadStaffAnnouncementStats(messageId);
      if (res.ok) {
        setStats(res.data);
        setError(null);
      } else {
        setError(res.error.message);
      }
    });
  }, [messageId]);

  useEffect(() => {
    if (!initial) load();
    // `initial` chỉ đọc ở lần đầu — đổi messageId mới tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {stats
            ? `Đã đọc ${stats.readCount}/${stats.totalRecipients}`
            : pending
              ? "Đang lấy số liệu…"
              : "Chưa có số liệu"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={pending}
          className="h-7 gap-1 px-2 text-xs"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          Làm mới
        </Button>
      </div>

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {stats && stats.unreadMembers.length > 0 && (
        <div className="mt-1.5">
          <p className="text-xs text-muted-foreground">Chưa đọc:</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {stats.unreadMembers.map((m) => (
              <li
                key={m.userId}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {m.displayName}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && stats.totalRecipients > 0 && stats.unreadMembers.length === 0 && (
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          Tất cả phụ huynh đã đọc.
        </p>
      )}

      {stats && stats.totalRecipients === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Nhóm chưa có phụ huynh nào — chưa tính được tỉ lệ đọc.
        </p>
      )}
    </div>
  );
}
