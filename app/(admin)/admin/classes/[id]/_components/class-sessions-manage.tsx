"use client";

// R7-06 — Quản lý buổi học của lớp: huỷ buổi (lý do bắt buộc) + điều chỉnh
// ngày/GV/phòng. Buổi CANCELLED hiển thị rõ (không ẩn) với nhãn "Đã hủy".
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Ban, Pencil, ExternalLink, CalendarX2 } from "lucide-react";
import { nhanSoBuoiVaBai } from "@/lib/lms/session-order";
import { cancelSessionAction, adjustSessionAction, nghiBuoiLuiLichAction } from "../_curriculum-actions";
import { CompleteSession } from "../session/_components/complete-session";
import { GiveHomework } from "../session/_components/give-homework";

export type SessionRow = {
  id: string;
  date: string; // ISO
  topic: string | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /**
   * Buổi thứ mấy của lớp (1-based, xếp theo ngày — lib/lms/session-order). Tính ở
   * page.tsx trên TOÀN BỘ buổi của lớp; null khi không tra được.
   */
  /** Buổi thứ mấy theo NGÀY — khớp thứ tự danh sách này. */
  seq: number | null;
  /** BÀI thứ mấy của giáo trình. Khác `seq` ở lớp có buổi dời ngày. */
  soLoTrinh: number | null;
  /**
   * Số bản ghi điểm danh / phiếu nhận xét của buổi (đếm ở page.tsx).
   *
   * ⚠️ Đây là thứ DUY NHẤT trên trang lớp cho biết giáo viên đã làm gì cho buổi nào.
   * `status` KHÔNG dùng được vào việc đó: điểm danh không đổi status, chỉ `completeSession`
   * mới đổi mà nó nằm sau cờ SESSION_LIFECYCLE_V2 (mặc định OFF) ⇒ buổi đã dạy vẫn đeo
   * nhãn "Đã lên lịch". Bỏ 2 số này đi là dựng lại đúng hiểu lầm "GV chưa điểm danh".
   */
  attendanceCount: number;
  feedbackCount: number;
};

export type Option = { id: string; label: string };

const STATUS_LABEL: Record<SessionRow["status"], { label: string; cls: string }> = {
  SCHEDULED: { label: "Đã lên lịch", cls: "bg-muted text-muted-foreground" },
  IN_PROGRESS: { label: "Đang diễn ra", cls: "bg-state-warning-soft text-state-warning-ink" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-state-success-soft text-state-success-ink" },
  CANCELLED: { label: "Đã hủy", cls: "bg-state-danger-soft text-state-danger-ink" },
};

/**
 * Buổi đã diễn ra chưa (tính cả hôm nay, giờ VN).
 * Chip "Chưa điểm danh" chỉ có nghĩa với buổi đã dạy — dán lên buổi của tháng sau thì cả
 * danh sách đỏ rực vì những việc chưa đến hạn, và người đọc hết phân biệt được buổi nào
 * đang thực sự thiếu.
 */
function daDienRa(iso: string): boolean {
  const now = new Date();
  const cuoiNgay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return new Date(iso).getTime() <= cuoiNgay.getTime();
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ClassSessionsManage({
  sessions,
  teachers,
  rooms,
  canEdit,
  lifecycleV2 = false,
}: {
  sessions: SessionRow[];
  teachers: Option[];
  rooms: Option[];
  canEdit: boolean;
  /** R7-07 — bật state machine "Hoàn tất buổi" (flag SESSION_LIFECYCLE_V2). */
  lifecycleV2?: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        <CalendarRange className="h-4 w-4" /> Quản lý buổi học
      </h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chưa có buổi học nào. Dùng &quot;Sinh buổi học&quot; ở mục lịch phía trên.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              teachers={teachers}
              rooms={rooms}
              canEdit={canEdit}
              lifecycleV2={lifecycleV2}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionItem({
  session,
  teachers,
  rooms,
  canEdit,
  lifecycleV2,
}: {
  session: SessionRow;
  teachers: Option[];
  rooms: Option[];
  canEdit: boolean;
  lifecycleV2: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"none" | "adjust" | "cancel" | "nghi">("none");
  const [date, setDate] = useState(session.date.slice(0, 10));
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [reason, setReason] = useState("");

  const cancelled = session.status === "CANCELLED";
  const badge = STATUS_LABEL[session.status];

  function doAdjust() {
    startTransition(async () => {
      const res = await adjustSessionAction(session.id, {
        date: date || null,
        teacherId: teacherId || null,
        roomId: roomId || null,
      });
      if (res.ok) {
        toast.success("Đã điều chỉnh buổi học");
        setMode("none");
        router.refresh();
      } else {
        toast.error(res.error ?? "Không điều chỉnh được");
      }
    });
  }

  function doCancel() {
    if (reason.trim().length < 5) {
      toast.error("Nhập lý do huỷ (≥5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await cancelSessionAction(session.id, reason.trim());
      if (res.ok) {
        toast.success("Đã huỷ buổi học");
        setMode("none");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Không huỷ được buổi");
      }
    });
  }

  function doNghi() {
    if (reason.trim().length < 5) {
      toast.error("Nhập lý do lớp nghỉ (≥5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await nghiBuoiLuiLichAction(session.id, reason.trim());
      if (res.ok) {
        toast.success("Đã cho lớp nghỉ buổi này và lùi lịch một nhịp");
        setMode("none");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Không lùi được lịch");
      }
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {/* Số buổi ở element RIÊNG (không ghép vào text node của ngày) — test hồi quy
              dò nhãn bằng getByText khớp chính xác. */}
          <span
            className={`mr-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums ${ cancelled ? "text-muted-foreground" : "text-foreground" }`}
          >
            {nhanSoBuoiVaBai({ lich: session.seq, loTrinh: session.soLoTrinh })}
          </span>
          <span
            className={`text-sm font-semibold tabular-nums ${ cancelled ? "text-muted-foreground line-through" : "text-foreground" }`}
          >
            {fmt(session.date)}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">
            {session.topic ?? "Buổi học"}
          </span>
          {!cancelled && daDienRa(session.date) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${ session.attendanceCount > 0 ? "bg-state-success-soft text-state-success-ink" : "border border-dashed border-border text-muted-foreground" }`}
              >
                {session.attendanceCount > 0
                  ? `Đã điểm danh ${session.attendanceCount}`
                  : "Chưa điểm danh"}
              </span>
              {session.feedbackCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  {session.feedbackCount} phiếu nhận xét
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>
          {/* Trang lớp trước đây KHÔNG có lối bấm nào sang chi tiết buổi — muốn xem
              checklist/nhận xét của buổi phải tự gõ URL. */}
          <Link
            href={`/sessions/${session.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-primary hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Chi tiết
          </Link>
          {canEdit && !cancelled && (
            <>
              <button
                type="button"
                onClick={() => setMode(mode === "adjust" ? "none" : "adjust")}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" /> Điều chỉnh
              </button>
              {/* Cả buổi ĐÃ QUA (27/09/2026). Ẩn khi buổi đã có dữ liệu — server từ chối ca
                  đó, vẽ nút là lời hứa suông (luật 12). */}
              {session.status !== "COMPLETED" &&
                session.attendanceCount === 0 &&
                session.feedbackCount === 0 && (
                <button
                  type="button"
                  onClick={() => setMode(mode === "nghi" ? "none" : "nghi")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <CalendarX2 className="h-3.5 w-3.5" /> Nghỉ &amp; lùi lịch
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
                className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-1 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft"
              >
                <Ban className="h-3.5 w-3.5" /> Huỷ
              </button>
            </>
          )}
        </div>
      </div>

      {lifecycleV2 &&
        canEdit &&
        (session.status === "SCHEDULED" || session.status === "IN_PROGRESS") && (
          <div className="mt-2">
            <CompleteSession
              sessionId={session.id}
              teachers={teachers}
              rooms={rooms}
            />
          </div>
        )}

      {/* R7-14 — buổi đã hoàn tất: cho GV "Giao bài" sau (trường hợp đã chọn DEFER). */}
      {lifecycleV2 && canEdit && session.status === "COMPLETED" && (
        <div className="mt-2">
          <GiveHomework sessionId={session.id} />
        </div>
      )}

      {mode === "adjust" && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Ngày
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                GV chính
              </span>
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">— Giữ nguyên —</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Phòng
              </span>
              <select
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">— Giữ nguyên —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={doAdjust}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : "Lưu điều chỉnh"}
          </button>
        </div>
      )}

      {mode === "nghi" && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted p-3">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Lý do lớp nghỉ (vd: Trung tâm tổ chức sự kiện) — bắt buộc"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <p className="text-xs text-muted-foreground">
            Chỉ lớp này nghỉ ngày {fmt(session.date)} — trung tâm và các lớp khác vẫn học bình
            thường. Buổi này thành &quot;Đã hủy&quot; (ghi lý do); bài của nó và các bài sau lùi
            sang buổi kế tiếp, cuối khoá thêm một buổi. Ngày, điểm danh, nhận xét của các buổi
            khác giữ nguyên.
          </p>
          <button
            type="button"
            onClick={doNghi}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Đang lùi lịch…" : "Xác nhận nghỉ & lùi lịch"}
          </button>
        </div>
      )}

      {mode === "cancel" && (
        <div className="mt-2 space-y-2 rounded-lg bg-state-danger-soft p-3">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Lý do huỷ buổi (bắt buộc, ≥5 ký tự)"
            className="w-full rounded-lg border border-state-danger-soft px-3 py-2 text-sm focus:border-state-danger focus:outline-none"
          />
          <p className="text-xs text-muted-foreground">
            Buổi sẽ chuyển trạng thái &quot;Đã hủy&quot; (không xoá). Buổi bù được
            xử lý theo lịch.
          </p>
          <button
            type="button"
            onClick={doCancel}
            disabled={pending}
            className="rounded-lg bg-state-danger-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-50"
          >
            {pending ? "Đang huỷ…" : "Xác nhận huỷ buổi"}
          </button>
        </div>
      )}
    </li>
  );
}
