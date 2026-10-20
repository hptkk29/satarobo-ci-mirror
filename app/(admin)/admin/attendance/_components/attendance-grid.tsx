// app/(admin)/admin/attendance/_components/attendance-grid.tsx
//
// 07/08/2026 — BỎ mặc định "Có mặt", theo đúng site GV (attendance-panel.tsx sửa cùng
// ngày). Trước đây mở lưới lên là cả lớp đã sáng "Có mặt" sẵn dù buổi chưa điểm danh:
// màn hình nói dối, và chỉ cần sửa 1 em rồi Lưu là buổi được tính "đã điểm danh" trong
// khi những em còn lại KHÔNG có bản ghi nào. Nay mọi ô đều TRỐNG, ai bấm mới có
// (không có bản ghi Attendance = chưa điểm danh — enum không có nhãn "chưa"), và nút
// Lưu ĐÒI đánh dấu đủ cả lớp. Xem lý do đầy đủ ở comment trong save().
"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, X, Clock, FileText, Save } from "lucide-react";
import { markAttendance } from "../_actions";
import { ENROLLMENT_STATUS } from "@/lib/labels/registry";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
type MakeupStatus = "NONE" | "NEEDS_MAKEUP" | "MADE_UP";
// R7-08 — DB thêm ABSENT_EXCUSED/ABSENT_UNEXCUSED (2-phase). Lưới điểm danh chỉ chỉnh
// 4 trạng thái gốc; 2 nhãn mới quy về gốc khi nạp state ban đầu.
type DbAttendanceStatus = AttendanceStatus | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED";
/**
 * ⚠️ 07/08/2026 — trả `null` khi HV CHƯA có bản ghi điểm danh (trước đây fallback
 * "PRESENT"). Đây chính là chỗ đẻ ra cảnh cả lớp sáng "Có mặt" khi vừa mở buổi chưa
 * điểm danh; giờ trạng thái phải do người dùng tự bấm.
 */
function toEditableStatus(
  s: DbAttendanceStatus | null | undefined,
): AttendanceStatus | null {
  if (s === "ABSENT_EXCUSED") return "EXCUSED";
  if (s === "ABSENT_UNEXCUSED") return "ABSENT";
  return s ?? null;
}

interface StudentRow {
  studentId: string;
  studentName: string;
  studentPhone: string | null;
  enrollmentStatus: string;
  existing: {
    id: string;
    status: DbAttendanceStatus;
    note: string | null;
    makeupStatus: MakeupStatus;
    absenceReason: string | null;
  } | null;
  // R7-08 — HS học bù liên cơ sở: tên CS gốc để hiện badge "Học bù từ <CS>".
  makeupFromCenter?: string | null;
  /**
   * `null` = được học buổi này; chuỗi = lý do CHƯA TỚI LƯỢT ("Đăng ký từ buổi N").
   *
   * 🔴 Hàng vẫn HIỆN, chỉ KHÔNG chấm được. Ẩn trắng là để giáo viên tự đoán vì sao thiếu
   * người (luật 12); còn để chấm được là thủng cổng — `getSessionRosterStudentIds` sẽ từ
   * chối lượt ghi và người dùng nhận một lỗi không giải thích được.
   */
  chuaToiLuot?: string | null;
  /** T08 — kết quả học bù của buổi này (đọc từ mô hình đọc duy nhất); chỉ để HIỆN, không phải thứ lưu lại. */
  ketQuaBu?: { trangThai: string; nhan: string; danhGia: string | null; coPhieu?: boolean } | null;
}

interface Props {
  sessionId: string;
  rows: StudentRow[];
}

const STATUS_META: Record<
  AttendanceStatus,
  { label: string; Icon: typeof Check; activeStyle: string; idleStyle: string }
> = {
  PRESENT: {
    label: "Có mặt",
    Icon: Check,
    activeStyle: "bg-state-success-ink text-white border-state-success-ink shadow",
    idleStyle: "bg-card text-muted-foreground border-border hover:bg-state-success-soft hover:border-state-success",
  },
  ABSENT: {
    label: "Vắng",
    Icon: X,
    activeStyle: "bg-state-danger-ink text-white border-state-danger-ink shadow",
    idleStyle: "bg-card text-muted-foreground border-border hover:bg-state-danger-soft hover:border-state-danger",
  },
  LATE: {
    label: "Muộn",
    Icon: Clock,
    activeStyle: "bg-state-warning text-white border-state-warning shadow",
    idleStyle: "bg-card text-muted-foreground border-border hover:bg-state-warning-soft hover:border-state-warning",
  },
  EXCUSED: {
    label: "Phép",
    Icon: FileText,
    activeStyle: "bg-state-info-ink text-white border-state-info-ink shadow",
    idleStyle: "bg-card text-muted-foreground border-border hover:bg-state-info-soft hover:border-state-info",
  },
};

const STATUS_ORDER: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

interface RowState {
  /** null = CHƯA điểm danh (không phải "có mặt"). */
  status: AttendanceStatus | null;
  note: string;
  makeupStatus: MakeupStatus;
  absenceReason: string;
  dirty: boolean;
}

const isAbsent = (s: AttendanceStatus | null) => s === "ABSENT" || s === "EXCUSED";

export function AttendanceGrid({ sessionId, rows }: Props) {
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const r of rows) {
      init[r.studentId] = {
        status: toEditableStatus(r.existing?.status),
        note: r.existing?.note ?? "",
        makeupStatus: r.existing?.makeupStatus ?? "NONE",
        absenceReason: r.existing?.absenceReason ?? "",
        dirty: false,
      };
    }
    return init;
  });
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; msg: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const dirtyCount = Object.values(state).filter((r) => r.dirty).length;
  /** Số HV chưa được đánh dấu — hiện lên để không ai tưởng buổi đã điểm danh xong. */
  const unmarked = rows.filter((r) => !state[r.studentId]?.status).length;

  /** HV ĐÃ có bản ghi trong DB lúc mở màn (dùng cho luật bỏ-chọn ở setStatus). */
  const savedIds = useMemo(
    () => new Set(rows.filter((r) => r.existing).map((r) => r.studentId)),
    [rows],
  );

  /**
   * Bấm lại đúng nhãn đang chọn = BỎ chọn (về "chưa điểm danh") — lỡ tay còn gỡ được.
   * CHỈ cho HV CHƯA có bản ghi trong DB: markAttendance chỉ upsert chứ không xoá, nên
   * bỏ chọn em đã lưu rồi bấm Lưu sẽ không xoá được gì — màn hình sẽ nói dối. Muốn sửa
   * em đã lưu thì chọn nhãn khác (hoặc xoá bản ghi ở luồng riêng).
   */
  function setStatus(studentId: string, status: AttendanceStatus) {
    setState((prev) => {
      const clearable = !savedIds.has(studentId);
      const next =
        prev[studentId]?.status === status && clearable ? null : status;
      // Vắng ⇒ mặc định CẦN HỌC BÙ (02/10/2026: mọi loại vắng đều cần bù); đã bù xong thì giữ.
      const cu = prev[studentId]?.makeupStatus;
      const makeupStatus: MakeupStatus = isAbsent(next) ? (cu === "MADE_UP" ? "MADE_UP" : "NEEDS_MAKEUP") : "NONE";
      return { ...prev, [studentId]: { ...prev[studentId], status: next, makeupStatus, dirty: true } };
    });
    setFeedback(null);
  }

  function setNote(studentId: string, note: string) {
    setState((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], note, dirty: true },
    }));
    setFeedback(null);
  }

  function setAbsenceReason(studentId: string, absenceReason: string) {
    setState((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], absenceReason, dirty: true },
    }));
    setFeedback(null);
  }

  function setMakeupStatus(studentId: string, makeupStatus: MakeupStatus) {
    setState((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], makeupStatus, dirty: true },
    }));
    setFeedback(null);
  }

  function markAllPresent() {
    setState((prev) => {
      const next: Record<string, RowState> = {};
      for (const [id, r] of Object.entries(prev)) {
        const changed = r.status !== "PRESENT";
        // QA 20/07 — dòng bị ĐỔI sang Có mặt thì xoá luôn ghi chú/lý do vắng cũ
        // (tránh dữ liệu mâu thuẫn kiểu "Có mặt" + note "đi muộn 10 phút").
        // Dòng vốn đã Có mặt giữ nguyên note.
        next[id] = {
          status: "PRESENT",
          note: changed ? "" : r.note,
          makeupStatus: changed ? "NONE" : r.makeupStatus,
          absenceReason: changed ? "" : r.absenceReason,
          dirty: changed || r.dirty,
        };
      }
      return next;
    });
    setFeedback(null);
  }

  function save() {
    // Phải đánh dấu đủ CẢ LỚP mới cho lưu. Không phải khắt khe cho vui: khắp hệ thống
    // (checklist buổi ở /admin/sessions/[id], cảnh báo khi hoàn tất buổi, dashboard +
    // cột "Cần xử lý" bên site GV) đều coi "buổi có ≥1 bản ghi Attendance = ĐÃ điểm
    // danh". Cho lưu dở dang thì buổi tô xanh "xong" trong khi vài em không có bản ghi
    // nào — im lặng mất người.
    if (unmarked > 0) {
      setFeedback({
        kind: "error",
        msg: `Còn ${unmarked} HV chưa đánh dấu — điểm danh đủ cả lớp rồi mới lưu được.`,
      });
      return;
    }

    // CHỈ gửi HV đã bấm trạng thái VÀ có thay đổi. Em chưa bấm = chưa điểm danh, không
    // ghi gì (Attendance không có nhãn "chưa" — không có bản ghi CHÍNH LÀ chưa).
    const records = Object.entries(state).flatMap(([studentId, r]) => {
      if (!r.dirty || !r.status) return [];
      return [
        {
          studentId,
          status: r.status,
          note: r.note.trim() || null,
          makeupStatus: isAbsent(r.status) ? r.makeupStatus : ("NONE" as MakeupStatus),
          absenceReason: isAbsent(r.status) ? r.absenceReason.trim() || null : null,
        },
      ];
    });
    if (records.length === 0) return;

    startTransition(async () => {
      const res = await markAttendance(sessionId, records);
      if (res.error) {
        setFeedback({ kind: "error", msg: res.error });
      } else {
        setFeedback({
          kind: "success",
          msg: `Đã lưu điểm danh cho ${res.saved} học viên.`,
        });
        // Clear dirty flags
        setState((prev) => {
          const next: Record<string, RowState> = {};
          for (const [id, r] of Object.entries(prev)) {
            next[id] = { ...r, dirty: false };
          }
          return next;
        });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center text-muted-foreground">
        Lớp này chưa có học viên đang học.
        <br />
        <a href="/enrollments" className="text-primary hover:underline">
          → Tạo đăng ký
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{rows.length} HV</strong> ·{" "}
            {dirtyCount > 0 ? (
              <span className="text-primary">{dirtyCount} thay đổi chưa lưu</span>
            ) : (
              <span className="text-muted-foreground">Không có thay đổi</span>
            )}
          </span>
          {unmarked > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted px-2 py-1 text-xs">
              <span className="h-2 w-2 rounded-full border border-border" />
              <span className="text-muted-foreground">Chưa điểm danh</span>
              <span className="font-bold text-foreground">{unmarked}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={markAllPresent}
            disabled={pending}
            className="rounded-lg border border-state-success bg-card px-3 py-1.5 text-sm font-semibold text-state-success-ink hover:bg-state-success-soft disabled:opacity-50"
          >
            Đánh dấu tất cả Có mặt
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || dirtyCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow hover:bg-primary-dark disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "Đang lưu..." : "Lưu điểm danh"}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${ feedback.kind === "success" ? "border-state-success-soft bg-state-success-soft text-state-success-ink" : "border-state-danger-soft bg-state-danger-soft text-state-danger-ink" }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <table className="w-full">
            <thead className="border-b border-border bg-muted text-left">
              <tr>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Học viên
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">
                  Trạng thái
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Ghi chú
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = state[r.studentId];
                const dirty = s?.dirty;
                return (
                  <tr
                    key={r.studentId}
                    className={`border-b border-border ${dirty ? "bg-primary-soft/40" : "hover:bg-muted"}`}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2 font-bold text-foreground">
                        {r.studentName}
                        {r.makeupFromCenter && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Học bù từ {r.makeupFromCenter}
                          </span>
                        )}
                      </div>
                      {r.ketQuaBu && (
                        <p
                          className={`mt-1 text-xs font-medium ${r.ketQuaBu.trangThai === "DA_BU" ? "text-state-success-ink" : "text-muted-foreground"}`}
                          title={r.ketQuaBu.danhGia ?? undefined}
                        >
                          {r.ketQuaBu.nhan}
                          {r.ketQuaBu.danhGia ? ` · “${r.ketQuaBu.danhGia}”` : ""}
                          {r.ketQuaBu.coPhieu ? " · có phiếu 9 tiêu chí" : ""}
                        </p>
                      )}
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {r.studentPhone && <span className="font-mono">{r.studentPhone}</span>}
                        {!r.makeupFromCenter && r.enrollmentStatus !== "ACTIVE" && (
                          <span className="rounded bg-state-warning-soft px-1.5 py-0.5 font-medium text-state-warning-ink">
                            {ENROLLMENT_STATUS.label(r.enrollmentStatus)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      {/* CHƯA TỚI LƯỢT — thay cả cụm nút bằng MỘT câu nói rõ vì sao.
                          Để nút `disabled` ở đây là bày ra sáu cái nút xám mà không ai
                          biết vì sao xám; một câu chữ trả lời thẳng câu hỏi ấy. */}
                      {r.chuaToiLuot ? (
                        <p className="text-center text-xs font-medium text-muted-foreground">
                          {r.chuaToiLuot} — chưa điểm danh buổi này
                        </p>
                      ) : (
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {STATUS_ORDER.map((status) => {
                          const meta = STATUS_META[status];
                          const active = s?.status === status;
                          const Icon = meta.Icon;
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() => setStatus(r.studentId, status)}
                              disabled={pending}
                              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${ active ? meta.activeStyle : meta.idleStyle }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                      )}
                    </td>
                    <td className="p-4">
                      {r.chuaToiLuot ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                      <>
                      <input
                        type="text"
                        value={s?.note ?? ""}
                        onChange={(e) => setNote(r.studentId, e.target.value)}
                        placeholder="Ghi chú (tuỳ chọn)"
                        disabled={pending}
                        className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                      />
                      {s && isAbsent(s.status) && (
                        <div className="mt-2 space-y-2 rounded-lg border border-state-danger-soft bg-state-danger-soft/60 p-2">
                          <input
                            type="text"
                            value={s.absenceReason}
                            onChange={(e) => setAbsenceReason(r.studentId, e.target.value)}
                            placeholder="Lý do phụ huynh xin vắng"
                            disabled={pending}
                            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-state-danger disabled:opacity-50"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(
                              [
                                ["NEEDS_MAKEUP", "Cần học bù"],
                                ["MADE_UP", "Đã học bù"],
                              ] as [MakeupStatus, string][]
                            ).map(([value, label]) => {
                              const active = s.makeupStatus === value;
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setMakeupStatus(r.studentId, value)}
                                  disabled={pending}
                                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${ active ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground hover:border-primary" }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
