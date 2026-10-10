// app/(teacher)/teacher/lop/_components/attendance-panel.tsx — #06 (câu 50).
//
// Visual PORT từ bàn giao Kiệt/H1 (satarobo-ui-giaovien/.../attendance-board.tsx,
// tìm thấy 10/07): chip 4 trạng thái / học viên + đếm nhanh + "tất cả có mặt" +
// avatar initials. GIỮ NGUYÊN data contract + action/guard thật của repo này:
// 4 status markable (2 nhãn còn lại NEEDS_MAKEUP/MADE_UP là hệ suy — đủ 6 nhãn SRS);
// nút Lưu gọi saveClassAttendanceAction(sessionId, records). Token màu theo tone
// ATTENDANCE_LABELS (lib/labels) — không dùng token riêng của project mock.
//
// Câu 46: rows KHÔNG chứa SĐT/contact — chỉ tên HV (server đã strip trước khi truyền).
//
// 07/08/2026 — BỎ mặc định "Có mặt": mở bảng lên mọi em đều TRỐNG, GV bấm nhãn nào
// mới có nhãn đó (không có bản ghi Attendance = chưa điểm danh — enum không có nhãn
// "chưa"). Nút "Đánh dấu tất cả có mặt" vẫn còn, nhưng nay là thao tác GV chủ động.
// Đổi lại, nút Lưu ĐÒI đủ cả lớp: xem lý do ở comment trong save().
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ATTENDANCE_LABELS, type AttendanceLabelTone } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "../../_components/ui/empty-state";
import { saveClassAttendanceAction } from "../_actions";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// 4 status GV được đánh (2 makeup còn lại NEEDS_MAKEUP/MADE_UP là hệ suy) → 6 nhãn SRS.
const MARKABLE = [
  "PRESENT",
  "LATE",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
] as const;
type Markable = (typeof MARKABLE)[number];

// Màu chip/chấm theo tone của ATTENDANCE_LABELS — đổi tone ở lib/labels là đổi cả đây.
const TONE_ACTIVE: Record<AttendanceLabelTone, string> = {
  green: "border-state-success bg-state-success text-white",
  amber: "border-state-warning bg-state-warning text-white",
  blue: "border-state-info bg-state-info text-white",
  red: "border-state-danger bg-state-danger text-white",
  // Site GV bỏ tông tím → tone "purple" (nhãn MADE_UP, không hiển thị ở panel này
  // vì chỉ render MARKABLE) dùng cam thương hiệu để không lệch khỏi hệ màu.
  purple: "border-primary bg-primary text-white",
  neutral: "border-muted-foreground bg-muted-foreground text-white",
};
const TONE_DOT: Record<AttendanceLabelTone, string> = {
  green: "bg-state-success",
  amber: "bg-state-warning",
  blue: "bg-state-info",
  red: "bg-state-danger",
  purple: "bg-primary",
  neutral: "bg-muted-foreground",
};

export type AttendancePanelRow = {
  studentId: string;
  studentName: string;
  enrollmentStatus: string;
  makeupFromCenter?: string | null;
  existingStatus: string | null;
  existingNote: string | null;
};

/**
 * Chuẩn hoá status cũ (2-phase R7-08) về 1 trong 4 nhãn markable.
 *
 * ⚠️ 07/08/2026 — trả `null` khi HV CHƯA có bản ghi điểm danh. Trước đây hàm này
 * fallback "PRESENT", nên mở bảng lên là cả lớp đã sáng "Có mặt" sẵn: bấm Lưu (hoặc
 * lỡ tay) là cả lớp thành có mặt + phụ huynh nhận thông báo, kể cả em vắng. Nay phải
 * do GV tự bấm mới có trạng thái.
 */
function normalize(status: string | null): Markable | null {
  if (!status) return null;
  if (status === "ABSENT") return "ABSENT_UNEXCUSED";
  if (status === "EXCUSED") return "ABSENT_EXCUSED";
  if ((MARKABLE as readonly string[]).includes(status))
    return status as Markable;
  return null; // enum chỉ có 6 giá trị trên — nhánh này coi như chưa điểm danh
}

export function AttendancePanel({
  sessionId,
  rows,
  editable,
}: {
  sessionId: string;
  rows: AttendancePanelRow[];
  editable: boolean;
}) {
  const [state, setState] = useState<
    Record<string, { status: Markable | null; note: string }>
  >(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.studentId,
        { status: normalize(r.existingStatus), note: r.existingNote ?? "" },
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /** Em ĐÃ có bản ghi điểm danh trong DB lúc mở màn (dùng cho luật bỏ-chọn ở setStatus). */
  const savedIds = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => normalize(r.existingStatus) !== null)
          .map((r) => r.studentId),
      ),
    [rows],
  );

  const { counts, unmarked } = useMemo(() => {
    const c: Record<Markable, number> = {
      PRESENT: 0,
      LATE: 0,
      ABSENT_EXCUSED: 0,
      ABSENT_UNEXCUSED: 0,
    };
    let u = 0;
    for (const r of rows) {
      const st = state[r.studentId]?.status ?? null;
      if (st) c[st]++;
      else u++;
    }
    return { counts: c, unmarked: u };
  }, [state, rows]);

  /**
   * Bấm lại đúng nhãn đang chọn = BỎ chọn (về "chưa điểm danh") — lỡ tay còn gỡ được.
   * CHỈ cho những em CHƯA có bản ghi trong DB: em đã lưu rồi mà bỏ chọn thì bấm Lưu
   * cũng không xoá được bản ghi cũ (action chỉ upsert, không delete) ⇒ màn hình sẽ nói
   * dối. Muốn sửa em đã lưu thì chọn nhãn khác.
   */
  function setStatus(studentId: string, status: Markable) {
    setState((s) => {
      const clearable = !savedIds.has(studentId);
      const next = s[studentId]?.status === status && clearable ? null : status;
      return { ...s, [studentId]: { ...s[studentId], status: next } };
    });
  }
  function setNote(studentId: string, note: string) {
    setState((s) => ({ ...s, [studentId]: { ...s[studentId], note } }));
  }
  function setAllPresent() {
    setState((s) =>
      Object.fromEntries(
        rows.map((r) => [
          r.studentId,
          { ...s[r.studentId], status: "PRESENT" as Markable },
        ]),
      ),
    );
  }

  function save() {
    // CHỈ gửi em đã được bấm trạng thái. Em chưa bấm = chưa điểm danh, không ghi gì
    // (Attendance không có nhãn "chưa" — không có bản ghi CHÍNH LÀ chưa).
    const records = rows.flatMap((r) => {
      const cell = state[r.studentId];
      if (!cell?.status) return [];
      return [
        {
          studentId: r.studentId,
          status: cell.status,
          note: cell.note?.trim() || null,
        },
      ];
    });
    if (records.length === 0) {
      toast.error(
        "Chưa đánh dấu em nào — bấm trạng thái cho từng học viên rồi lưu.",
      );
      return;
    }

    // Phải đủ CẢ LỚP mới cho lưu. Lý do không phải khắt khe cho vui: khắp hệ thống
    // (dashboard GV, cột "Cần xử lý" ở /teacher/lop, trang /teacher/diem-danh) đều coi
    // "buổi có ≥1 bản ghi Attendance = ĐÃ điểm danh". Cho lưu dở dang thì buổi tô xanh
    // "xong" trong khi vài em không có bản ghi nào — im lặng mất người.
    if (unmarked > 0) {
      toast.error(
        `Còn ${unmarked} em chưa đánh dấu — điểm danh đủ cả lớp rồi mới lưu được.`,
      );
      return;
    }

    startTransition(async () => {
      const res = await saveClassAttendanceAction(sessionId, records);
      if (res.ok) {
        toast.success(`Đã lưu điểm danh ${res.saved} học viên`);
        // Nạp lại RSC sau khi ghi: `savedIds` (và mọi chỉ báo "đã điểm danh" quanh nó)
        // suy từ prop `rows` — không refresh thì nó đóng băng ở bản chụp lúc mount, GV
        // mở lại thấy chip trắng trong khi DB đã có bản ghi rồi tưởng lưu hụt.
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={Users} title="Lớp chưa có học viên đang học." />;
  }

  return (
    <div className="space-y-3">
      {/* Tổng hợp gọn + thao tác nhanh (port từ attendance-board) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
          <span className="font-semibold text-foreground">
            {rows.length} học viên
          </span>
          {unmarked > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted px-2 py-1 text-xs">
              <span className="h-2 w-2 rounded-full border border-muted-foreground" />
              <span className="text-muted-foreground">Chưa điểm danh</span>
              <span className="font-bold text-foreground">{unmarked}</span>
            </span>
          )}
          {MARKABLE.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  TONE_DOT[ATTENDANCE_LABELS[k].tone],
                )}
              />
              <span className="text-muted-foreground">
                {ATTENDANCE_LABELS[k].label}
              </span>
              <span className="font-bold text-foreground">{counts[k]}</span>
            </span>
          ))}
        </div>
        {editable && (
          <button
            type="button"
            onClick={setAllPresent}
            disabled={pending}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary-ink hover:text-primary-ink-hover disabled:cursor-not-allowed disabled:text-muted-foreground"
          >
            <Check className="h-4 w-4" aria-hidden /> Đánh dấu tất cả có mặt
          </button>
        )}
      </div>

      {/* Vùng cuộn ngang nằm TRONG PhanTrangBang (cờ `cuonNgang`) để thanh phân trang
          không bị kéo trôi khỏi màn khi cuộn bảng sang phải.
          `overflow-hidden` là thứ CẮT góc cho khung: dời thanh cuộn vào trong đã lấy mất
          `overflow-x-auto` — thứ duy nhất từng tạo vùng cắt — nên hàng tiêu đề `bg-muted/50`
          thò góc vuông ra ngoài viền bo. Không tái lập thanh cuộn ở ngoài. */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <PhanTrangBang cuonNgang tenDonVi="học viên"
          khoaGhiNho="gv-diem-danh-buoi">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Học viên</TableHead>
                <TableHead>Trạng thái điểm danh</TableHead>
                <TableHead className="w-[220px]">Ghi chú</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.studentId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                        {initialsOf(r.studentName)}
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/teacher/hoc-vien?s=${r.studentId}`}
                          className="block truncate text-sm font-semibold text-foreground hover:text-primary-ink-hover hover:underline"
                          title="Mở hồ sơ học viên"
                        >
                          {r.studentName}
                        </Link>
                        {r.makeupFromCenter && (
                          <span className="mt-0.5 inline-block rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary-ink">
                            Học bù từ {r.makeupFromCenter}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {MARKABLE.map((k) => {
                        const info = ATTENDANCE_LABELS[k];
                        const active = state[r.studentId]?.status === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            disabled={!editable || pending}
                            onClick={() => setStatus(r.studentId, k)}
                            aria-pressed={active}
                            aria-label={`${info.label} — ${r.studentName}`}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              active
                                ? TONE_ACTIVE[info.tone]
                                : "border-border bg-card text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {info.label}
                          </button>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
                      placeholder="—"
                      value={state[r.studentId]?.note ?? ""}
                      disabled={!editable || pending}
                      onChange={(e) => setNote(r.studentId, e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {unmarked > 0 && (
            <p className="text-sm text-muted-foreground">
              Còn{" "}
              <span className="font-semibold text-foreground">{unmarked}</span>{" "}
              em chưa đánh dấu
            </p>
          )}
          <Button onClick={save} disabled={pending}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden />
            {pending ? "Đang lưu…" : "Lưu điểm danh"}
          </Button>
        </div>
      )}
    </div>
  );
}
