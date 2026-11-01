"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, AlertTriangle, CalendarSync } from "lucide-react";
import {
  previewClassReschedule,
  applyClassReschedule,
  generateSessionsAction,
  resyncClassSessionsAction,
} from "../../_actions";

type Item = { id: string; topic: string | null; oldDate: string; newDate: string };
/** T4.1 — buổi ở lịch mới bị trùng phòng/GV với lớp khác (chặn apply). */
type Conflict = { date: string; messages: string[] };

/** Kết quả soát "dãy buổi có khớp ngày khai giảng + lịch học" (tính ở RSC). */
export interface SessionAuditProp {
  severity: string;
  message: string | null;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function ClassReschedule({
  classId,
  canEdit,
  audit,
}: {
  classId: string;
  canEdit: boolean;
  audit?: SessionAuditProp;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<Item[] | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  if (!canEdit) return null;

  // Neo sai / chưa có buổi = lỗi thật, phải nổi bật. "DRIFT" thường là hệ quả của việc
  // đổi lịch giữa khoá (hợp lệ) nên chỉ nhắc nhẹ.
  const severe = audit?.severity === "ANCHOR_WRONG" || audit?.severity === "NO_SESSIONS";
  const notable = severe || audit?.severity === "DRIFT" || audit?.severity === "NO_SCHEDULE";

  function resync() {
    startTransition(async () => {
      const res = await resyncClassSessionsAction(classId);
      if (!res.ok) {
        toast.error(res.error ?? "Không xếp lại được buổi học");
        return;
      }
      const parts: string[] = [];
      if (res.generated) parts.push(`sinh ${res.generated} buổi`);
      if (res.moved) parts.push(`dời ${res.moved} buổi`);
      if (res.kept) parts.push(`giữ ${res.kept} buổi đã có dữ liệu`);
      toast.success(parts.length ? `Đã xếp lại: ${parts.join(", ")}` : "Dãy buổi đã khớp lịch");
      if (res.warning) toast.warning(res.warning);
      setItems(null);
      setConflicts([]);
      router.refresh();
    });
  }

  function preview() {
    startTransition(async () => {
      const res = await previewClassReschedule(classId);
      if (res.ok) {
        setItems(res.items);
        setConflicts(res.conflicts);
        if (res.items.length === 0) toast.info("Không có buổi tương lai để dời");
        else if (res.conflicts.length > 0) {
          toast.warning(`${res.conflicts.length} buổi ở lịch mới bị trùng phòng/GV`);
        }
      } else {
        toast.error(res.error);
      }
    });
  }

  function apply() {
    startTransition(async () => {
      const res = await applyClassReschedule(classId);
      if (res.ok) {
        toast.success("Đã dời buổi tương lai theo lịch mới + lịch nghỉ");
        setItems(null);
        setConflicts([]);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const changed = items?.filter((it) => fmt(it.oldDate) !== fmt(it.newDate)) ?? [];

  function generate() {
    startTransition(async () => {
      const res = await generateSessionsAction(classId);
      if (res.ok) {
        if (res.generated) toast.success(`Đã sinh ${res.generated} buổi học`);
        // T4.1 — buổi vừa sinh trùng phòng/GV với lớp khác (cảnh báo, không chặn).
        // 08/08 — lớp đã có buổi thì action trả warning nói rõ nút này KHÔNG sửa dãy cũ.
        if (res.warning) toast.warning(res.warning);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Buổi học theo lịch
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            <CalendarPlus className="h-4 w-4" /> Sinh buổi học
          </button>
          <button
            type="button"
            onClick={resync}
            disabled={pending}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${ severe ? "bg-state-danger-ink text-white hover:bg-state-danger-ink" : "border border-border text-foreground hover:bg-muted" }`}
          >
            <CalendarSync className="h-4 w-4" /> Xếp lại buổi theo lịch
          </button>
          <button
            type="button"
            onClick={preview}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Xem trước dời
          </button>
        </div>
      </div>

      {/* 08/08 — dãy buổi lệch ngày khai giảng / lịch học là lỗi im lặng: `endDate` được
          tính lại theo lịch mới còn buổi giữ nguyên dãy cũ. Nay soát ở RSC và nói thẳng. */}
      {notable && audit?.message && (
        <div
          className={`mb-3 rounded-lg border p-3 text-sm ${ severe ? "border-state-danger-soft bg-state-danger-soft text-state-danger-ink" : "border-state-warning-soft bg-state-warning-soft text-state-warning-ink" }`}
        >
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{audit.message}</span>
          </p>
        </div>
      )}

      <p className="mb-2 text-xs text-muted-foreground">
        &quot;Sinh buổi học&quot; tạo buổi theo lịch lớp + số buổi chuẩn của khoá, bỏ qua ngày nghỉ (chỉ khi lớp CHƯA có buổi). Lớp duyệt ACTIVE tự sinh.
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        &quot;Xếp lại buổi theo lịch&quot; neo lại CẢ DÃY buổi từ ngày khai giảng theo lịch hiện tại
        (trừ ngày nghỉ). Chỉ đổi ngày — không tạo, không xoá buổi; buổi đã điểm danh / có nhận xét /
        đã giao bài / có ảnh / đã hoàn tất giữ nguyên ngày.
      </p>
      <p className="text-xs text-muted-foreground">
        &quot;Xem trước dời&quot; chỉ áp lịch cho các buổi CHƯA diễn ra; buổi trùng lịch nghỉ cơ sở sẽ dời sang buổi kế (giữ đủ tổng buổi). Buổi đã diễn ra giữ nguyên.
      </p>

      {items && (
        <div className="mt-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có buổi tương lai.</p>
          ) : (
            <>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {items.map((it) => {
                  const moved = fmt(it.oldDate) !== fmt(it.newDate);
                  return (
                    <li key={it.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{it.topic ?? "Buổi học"}</span>
                      <span className={`tabular-nums ${moved ? "font-semibold text-state-warning-ink" : "text-muted-foreground"}`}>
                        {fmt(it.oldDate)}{moved ? ` → ${fmt(it.newDate)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">{changed.length} buổi sẽ đổi ngày.</p>

              {/* T4.1 — trùng phòng/GV là lỗi CHẶN: nêu rõ ngày để đổi phòng/GV/lịch. */}
              {conflicts.length > 0 && (
                <div className="mt-2 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-state-danger-ink">
                    <AlertTriangle className="h-4 w-4" /> Lịch mới trùng phòng/giáo viên —
                    không áp dụng được
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-state-danger-ink">
                    {conflicts.map((c) => (
                      <li key={c.date}>
                        {fmt(c.date)} — {c.messages.join("; ")}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-state-danger-ink">
                    Đổi phòng/GV của lớp hoặc chọn lịch khác rồi xem lại.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={apply}
                disabled={pending || conflicts.length > 0}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Đang áp dụng…" : "Áp dụng dời buổi"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
