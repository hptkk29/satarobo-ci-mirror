"use client";

// M1 + M2 (BA §7.4) — cây NGÀY → LỚP còn phải xử lý.
//
// Gộp hai mức vào một màn thay vì hai route: mở/đóng ngày là state client, không phải
// lượt tải trang. Ngày mới nhất mở sẵn — sáng ra QLCS mở màn là thấy ngay việc của
// hôm qua, không phải bấm thêm một nhát.
import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Film,
  ImageIcon,
  Info,
  User as UserIcon,
} from "lucide-react";
import type { ReviewDayNode } from "@/lib/media-review/tree";

export function ReviewTree({ days }: { days: ReviewDayNode[] }) {
  // Ngày đầu tiên (mới nhất) mở sẵn.
  const [dong, setDong] = useState<Set<string>>(new Set(days.slice(1).map((d) => d.date)));

  function toggle(date: string) {
    setDong((cu) => {
      const s = new Set(cu);
      if (s.has(date)) s.delete(date);
      else s.add(date);
      return s;
    });
  }

  const tongLop = days.reduce((n, d) => n + d.classes.length, 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-foreground">Duyệt ảnh lớp học</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tongLop === 0
            ? "Không còn buổi nào chờ duyệt."
            : `${tongLop} buổi chờ duyệt trong 30 ngày gần nhất. Duyệt xong buổi nào, buổi đó rời khỏi danh sách.`}
        </p>
      </header>

      {days.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <ImageIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">Đã duyệt hết</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Mọi buổi học đã có kết luận — ảnh đã duyệt hoặc đã ghi nhận “không có ảnh”.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((day) => {
            const mo = !dong.has(day.date);
            return (
              <section key={day.date} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggle(day.date)}
                  aria-expanded={mo}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50"
                >
                  {mo ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="font-semibold text-foreground">{day.label}</span>
                  <span className="text-sm text-muted-foreground">
                    — {day.classes.length} lớp chờ duyệt
                  </span>
                  {day.overdue && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Quá hạn
                    </span>
                  )}
                </button>

                {mo && (
                  <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-3">
                    {day.classes.map((c) => (
                      <ClassCard key={c.classSessionId} node={c} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClassCard({ node }: { node: ReviewDayNode["classes"][number] }) {
  const tong = node.images + node.videos;
  return (
    <Link
      href={`/duyet-media?sessionId=${node.classSessionId}`}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-background p-3 transition hover:border-primary hover:shadow-sm"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-semibold text-foreground group-hover:text-primary">
          {node.className}
          {node.classCode && (
            <span className="ml-1 font-normal text-muted-foreground">({node.classCode})</span>
          )}
        </span>
        {node.overdue && (
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-red-600"
            aria-label="Quá hạn duyệt"
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground">{node.sessionLabel}</p>

      {/* BA US-02.3: ⓘ cho biết AI đứng buổi đó + giờ học — QLCS cần hỏi đúng người khi
          thiếu ảnh, mà GV đứng buổi có thể là người dạy thay. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {node.teacherName && (
          <span className="inline-flex items-center gap-1">
            <UserIcon className="h-3 w-3" aria-hidden />
            {node.teacherName}
          </span>
        )}
        {node.timeLabel && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {node.timeLabel}
          </span>
        )}
        {node.centerName && <span>{node.centerName}</span>}
      </p>

      <div className="flex items-center gap-3 border-t border-border pt-2 text-xs">
        {tong === 0 ? (
          <span className="font-medium text-amber-700 dark:text-amber-400">Chưa có ảnh nào</span>
        ) : (
          <>
            {node.images > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                {node.images} ảnh
              </span>
            )}
            {node.videos > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Film className="h-3.5 w-3.5" aria-hidden />
                {node.videos} video
              </span>
            )}
            <span className="text-muted-foreground">chờ duyệt</span>
          </>
        )}
      </div>
    </Link>
  );
}
