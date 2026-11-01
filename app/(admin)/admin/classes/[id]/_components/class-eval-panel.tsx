"use client";

import { useState, useTransition } from "react";
import { ClipboardCheck } from "lucide-react";
import { SessionEvalFill, type StudentLite } from "../../../evaluations/_components/session-eval-fill";
import { loadClassSessionRoster } from "../_attendance-actions";
import type { AttendanceRosterRow } from "@/lib/attendance/roster";
import { formatDateDMY } from "@/lib/format/date";
import { nhanSoBuoiVaBai } from "@/lib/lms/session-order";
import type { SessionRow } from "./class-sessions-manage";

function fmt(dateIso: string): string {
  const d = new Date(dateIso);
  const day = formatDateDMY(d);
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function rowsToEvalStudents(rows: AttendanceRosterRow[]): StudentLite[] {
  return rows.map((r) => ({
    studentId: r.studentId,
    name: r.studentName,
    present: r.existing?.status === "PRESENT" || r.existing?.status === "LATE",
  }));
}

/** Danh sách HV đang hiển thị PHẢI đi cùng buổi sinh ra nó (xem ghi chú component). */
type Loaded = { sessionId: string; students: StudentLite[] };

/**
 * R2-CLASS-7 — Tab "Đánh giá" lớp chính: chọn buổi → nạp DS học viên (qua roster
 * điểm danh, scope-checked) → SessionEvalFill (phiếu SESSION_EVAL lớp chính). Học
 * viên buổi mặc định render server-side; đổi buổi mới fetch lại (không useEffect).
 *
 * ⚠️ Vá cùng bệnh với ClassAttendancePanel (bug 19/08): `selectedId` và `students` để
 * rời nhau thì có một nhịp render key MỚI + dữ liệu CŨ ⇒ SessionEvalFill remount bằng
 * danh sách HV của buổi trước rồi đứng yên. Gộp vào một state `Loaded`, chỉ set cùng lúc.
 */
export function ClassEvalPanel({
  sessions,
  initialSessionId,
  initialStudents,
  canEdit,
}: {
  sessions: SessionRow[];
  initialSessionId: string | null;
  initialStudents: StudentLite[];
  canEdit: boolean;
}) {
  const server: Loaded = { sessionId: initialSessionId ?? "", students: initialStudents };
  const [picked, setPicked] = useState<Loaded | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Lựa chọn của người dùng THẮNG bản server.
  //
  // ⚠️ ĐỪNG "tối ưu" thành `picked.sessionId === server.sessionId ? server : picked` —
  // đã thử và đó là hồi quy: chọn LẠI đúng buổi mặc định (thao tác tự nhiên nhất để làm
  // tươi dữ liệu) sẽ vứt roster vừa nạp và quay về ảnh chụp RSC lúc mở trang, tức tái
  // hiện đúng triệu chứng gốc "GV điểm danh rồi mà admin không thấy".
  const loaded = picked ?? server;
  const selectedId = pendingId ?? loaded.sessionId;
  const loading = pendingId !== null && pendingId !== loaded.sessionId;

  function onSelect(id: string) {
    setError(null);
    if (!id) {
      setPendingId(null);
      setPicked({ sessionId: "", students: [] });
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      const res = await loadClassSessionRoster(id);
      setPendingId(null);
      if (res.ok) {
        setPicked({ sessionId: id, students: rowsToEvalStudents(res.rows) });
      } else {
        setPicked({ sessionId: id, students: [] });
        setError(res.error);
      }
    });
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-muted p-8 text-center text-sm text-muted-foreground">
        <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        Lớp chưa có buổi học để đánh giá.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block max-w-md">
        <span className="mb-1 block text-sm font-semibold text-foreground">Chọn buổi đánh giá</span>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">— Chọn buổi học —</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {/* Số buổi mở đầu — khớp dropdown tab Điểm danh (class-attendance-panel).
                  Đợt 1c: in CẢ HAI số khi lệch (`Buổi 2 · bài 43`) — xem ghi chú ở đó. */}
              {`${nhanSoBuoiVaBai({ lich: s.seq, loTrinh: s.soLoTrinh })} · `}
              {fmt(s.date)}
              {s.topic ? ` — ${s.topic}` : ""}
              {s.status === "CANCELLED" ? " (đã huỷ)" : ""}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {loading ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Đang tải danh sách học viên của buổi…
        </p>
      ) : loaded.sessionId && !error ? (
        <SessionEvalFill
          key={loaded.sessionId}
          sessionId={loaded.sessionId}
          students={loaded.students}
          canEdit={canEdit}
        />
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Chọn một buổi học để mở phiếu đánh giá.</p>
      ) : null}
    </div>
  );
}
