"use client";

// Cấp 2 của màn điểm danh: DANH SÁCH BUỔI của MỘT lớp.
//
// Mỗi dòng là một buổi, mang đủ ba việc sau buổi và bốn nút để làm chúng ngay tại chỗ
// (chốt 21/08): Điểm danh · Nhận xét · Tải ảnh · Hoàn tất buổi. Trước đó người dùng
// phải nhớ đường sang ba màn khác nhau rồi mới quay lại đây xem đã đủ chưa.
//
// Cột "Buổi học" lấy từ GIÁO TRÌNH của lớp (deriveSessionLabel: kế hoạch buổi ghim
// cho lớp → tên bài của giáo án → chủ đề gõ tay), không phải chuỗi nhập tay ở cấp buổi.
//
// Thứ tự + phân bậc tính SẴN Ở SERVER (lib/lms/attendance-queue). Ở đây chỉ lọc và vẽ —
// lọc không được đảo thứ tự.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  ATTENDANCE_QUEUE_LABEL,
  type AttendanceQueuePhase,
} from "@/lib/lms/attendance-queue";
// Hộp thoại tải ảnh/video DÙNG LẠI của site GV — nó vốn đã gọi action admin
// (app/(admin)/admin/media/actions) và mang đủ luật consent C6.2/C6.3. Chép lại sang
// đây là đẻ ra bản thứ hai của luật đó, sớm muộn cũng lệch nhau.
// 25/08: hộp thoại đó nay BẮT BUỘC chọn buổi và ảnh đi thẳng vào hàng chờ duyệt (không
// còn kho, không còn "đăng ngay 1 ảnh"). Nút theo dòng đã truyền sẵn buổi của dòng đó.
import { UploadPhotoDialog } from "@/app/(teacher)/teacher/anh-lop/_components/upload-photo-dialog";
import { completeAttendanceSessionAction } from "../_actions";
import { ChotBuoiButton } from "@/components/lms/chot-buoi-button";
import { cn } from "@/lib/utils";

export interface AttendanceListRow {
  id: string;
  classId: string;
  /**
   * Buổi thứ mấy của lớp (null = không tra được). Chỉ dùng để XẾP THỨ TỰ ở server —
   * phần hiển thị đã nằm trong `sessionLabel`.
   */
  number: number | null;
  /**
   * Nhãn buổi đầy đủ: `"Buổi 3 - HP1 - Bàn Tay Ma Thuật"`. Server dựng sẵn
   * (deriveSessionLabel); khoá không chia học phần thì tự rút còn `"Buổi 3 - <tên bài>"`,
   * lớp chưa ghim giáo trình thì còn `"Buổi 3"`.
   */
  sessionLabel: string;
  /** Đã format theo giờ VN ở server — client không tự format kẻo lệch hydrate. */
  dateLabel: string;
  timeLabel: string;
  phase: AttendanceQueuePhase;
  /** ClassSession.status === "COMPLETED" — đã bấm "Hoàn tất buổi". */
  completed: boolean;
  roster: number;
  marked: number;
  attended: number;
  attendanceDone: boolean;
  feedbackDone: boolean;
  photoDone: boolean;
  /** Bao nhiêu em đi học đã có ảnh — chỉ để hiển thị "Ảnh 7/9". */
  photoCovered: number;
}

const ALL = "ALL";

const PHASE_TONE: Record<AttendanceQueuePhase, PillTone> = {
  PENDING: "warning",
  TODAY: "info",
  UPCOMING: "muted",
  DONE: "success",
  NO_ROSTER: "muted",
  CANCELLED: "muted",
};

/** Bậc bày thành chip đếm nhanh ở đầu bảng — chỉ những bậc CÒN VIỆC hoặc đã xong việc. */
const SUMMARY_PHASES: AttendanceQueuePhase[] = ["PENDING", "TODAY", "UPCOMING", "DONE"];

/** Bậc còn lại vẫn phải lọc được, chỉ là không đáng một ô đếm ở đầu bảng. */
const EXTRA_PHASES: AttendanceQueuePhase[] = ["NO_ROSTER", "CANCELLED"];

/**
 * Buổi chưa tới giờ, buổi huỷ, lớp hết học viên: 3 việc sau buổi chưa (hoặc không còn)
 * có nghĩa — bày chip xám ở đó chỉ đọc như "đang thiếu" trong khi không ai làm gì được.
 */
function showsWorkChips(phase: AttendanceQueuePhase): boolean {
  return phase === "PENDING" || phase === "DONE";
}

function WorkChip({
  done,
  label,
  icon: Icon,
}: {
  done: boolean;
  label: string;
  icon: typeof Camera;
}) {
  return (
    <span
      title={done ? `${label}: xong` : `${label}: chưa xong`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        done
          ? "bg-[color:var(--state-success-soft)] text-[color:var(--state-success)]"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Nút chốt buổi — chỉ sáng khi đủ ba việc; server vẫn kiểm lại lần nữa.
 *
 * 07/09 (D1): thân nút dời sang `components/lms/chot-buoi-button.tsx` để site giáo
 * viên dùng CHUNG. Ở đây chỉ còn nhánh "đã chốt" (nhãn riêng của màn này) và câu báo
 * thiếu việc — bản admin nói KÈM SỐ ("ảnh/video (0/9 em)") vì màn này có sẵn hai con
 * số đó, còn site GV thì không.
 */
function CompleteButton({
  row,
  onDone,
}: {
  row: AttendanceListRow;
  onDone: () => void;
}) {
  // Nhãn KHÁC chữ với bậc "Đã hoàn tất" ở cột Tình trạng — hai thứ khác nhau: bậc nói
  // ba việc đã xong, nhãn này nói TRẠNG THÁI BUỔI đã được người có quyền chốt.
  if (row.completed) {
    return (
      <StatusPill tone="success" className="gap-1 px-2.5 py-1">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Đã chốt buổi
      </StatusPill>
    );
  }

  return (
    <ChotBuoiButton
      sessionId={row.id}
      daChot={false}
      sanSang={row.attendanceDone && row.feedbackDone && row.photoDone}
      thieu={[
        row.attendanceDone ? null : "điểm danh đủ lớp",
        row.feedbackDone ? null : "nhận xét",
        row.photoDone ? null : `ảnh/video (${row.photoCovered}/${row.attended} em)`,
      ].filter((x): x is string => x !== null)}
      chot={completeAttendanceSessionAction}
      onXong={onDone}
    />
  );
}

export function AttendanceList({
  rows,
  classId,
  className,
  canComplete,
  canFeedback,
}: {
  rows: AttendanceListRow[];
  classId: string;
  className: string;
  /** `sessions:edit` — không có thì ẩn nút chốt buổi (server vẫn chặn). */
  canComplete: boolean;
  /**
   * Có được mở phiếu nhận xét buổi không. Sale / Quản lý lớp học = `false`:
   * `/sessions/[id]` redirect họ ra, nên hiện nút là chỉ đường tới ngõ cụt.
   */
  canFeedback: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<string>(ALL);

  const counts = useMemo(() => {
    const m = new Map<AttendanceQueuePhase, number>();
    for (const r of rows) m.set(r.phase, (m.get(r.phase) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (phase !== ALL && r.phase !== phase) return false;
      if (!q) return true;
      // `sessionLabel` đã chứa cả "Buổi N" lẫn tên bài lẫn học phần ⇒ một khoá tìm là đủ.
      return (
        r.sessionLabel.toLowerCase().includes(q) || r.dateLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, query, phase]);

  const phaseOptions = [
    { value: ALL, label: "Mọi tình trạng" },
    ...[...SUMMARY_PHASES, ...EXTRA_PHASES].map((p) => ({
      value: p,
      label: ATTENDANCE_QUEUE_LABEL[p],
    })),
  ];

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tiêu đề buổi, ngày, số buổi..."
            aria-label="Tìm buổi học"
            className="h-10 w-full rounded-xl border border-border bg-muted/50 pr-4 pl-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={phase}
            onValueChange={(v) => {
              if (v !== null) setPhase(v);
            }}
          >
            <SelectTrigger
              aria-label="Lọc theo tình trạng"
              className="h-10 w-auto min-w-[10rem] rounded-xl font-medium"
            >
              <SelectValue>
                {(v: string | null) =>
                  phaseOptions.find((o) => o.value === v)?.label ?? "Mọi tình trạng"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {phaseOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Tải ảnh cho lớp — buổi chọn TRONG hộp thoại (bắt buộc từ 25/08). Nút ở từng
              dòng tiện hơn vì đã chọn sẵn buổi của dòng đó. */}
          <UploadPhotoDialog classId={classId} />
        </div>
      </div>

      {/* Đếm nhanh theo bậc — bấm để lọc, bấm lại để bỏ lọc. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SUMMARY_PHASES.map((p) => {
          const n = counts.get(p) ?? 0;
          const active = phase === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPhase(active ? ALL : p)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="font-semibold">{ATTENDANCE_QUEUE_LABEL[p]}</span>
              <span className="font-black text-foreground">{n}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Không có buổi học nào khớp bộ lọc"
          description="Thử đổi từ khoá hoặc chọn lại tình trạng."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="buổi học">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={adminTh}>
                    Buổi học
                  </th>
                  <th scope="col" className={adminTh}>
                    Ngày
                  </th>
                  <th scope="col" className={adminTh}>
                    Có mặt
                  </th>
                  <th scope="col" className={adminTh}>
                    Tình trạng
                  </th>
                  <th scope="col" className={cn(adminTh, "text-right")}>
                    Việc của buổi
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={adminTr}>
                    <td className={cn(adminTd, "max-w-[26rem]")}>
                      <span className="block truncate font-semibold text-foreground">
                        {r.sessionLabel}
                      </span>
                      {r.timeLabel && (
                        <span className="block text-xs text-muted-foreground">
                          {r.timeLabel}
                        </span>
                      )}
                    </td>
                    <td className={adminTd}>{r.dateLabel}</td>
                    <td className={cn(adminTd, "font-semibold tabular-nums")}>
                      {r.marked > 0 ? `${r.attended}/${r.roster}` : "—"}
                    </td>
                    <td className={cn(adminTd, "whitespace-normal")}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={PHASE_TONE[r.phase]}>
                          {ATTENDANCE_QUEUE_LABEL[r.phase]}
                        </StatusPill>
                        {showsWorkChips(r.phase) && (
                          <>
                            <WorkChip
                              done={r.attendanceDone}
                              label={`Điểm danh ${r.marked}/${r.roster}`}
                              icon={ClipboardCheck}
                            />
                            <WorkChip
                              done={r.feedbackDone}
                              label="Nhận xét"
                              icon={MessageSquare}
                            />
                            <WorkChip
                              done={r.photoDone}
                              label={`Ảnh/video ${r.photoCovered}/${r.attended}`}
                              icon={Camera}
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td className={cn(adminTd, "whitespace-normal")}>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/attendance?classId=${classId}&sessionId=${r.id}`}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
                            Điểm danh
                          </Link>
                        </Button>
                        {canFeedback && (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/sessions/${r.id}`}>
                              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                              Nhận xét
                            </Link>
                          </Button>
                        )}
                        <UploadPhotoDialog
                          classId={classId}
                          initialSessionId={r.id}
                          compact
                        />
                        {canComplete && (
                          <CompleteButton row={r} onDone={() => router.refresh()} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        “Hoàn tất” chỉ sáng khi buổi đã điểm danh đủ lớp, và <strong>mọi học viên đi
        học</strong> đều có nhận xét lẫn ảnh/video (ảnh riêng, hoặc một ảnh chung cả
        lớp). Học viên vắng thì miễn cả hai. Nút này KHÔNG giao bài tập và không gửi
        thông báo bài tập cho phụ huynh — giao bài vẫn làm ở trang lớp {className}.
      </p>
    </>
  );
}
