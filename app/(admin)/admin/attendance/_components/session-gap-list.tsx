// E-01 — DANH SÁCH ĐÍCH của thẻ "Buổi học & đánh giá còn thiếu".
//
// Đây là cấp 0 của màn /attendance: gộp NHIỀU LỚP trong một khoảng ngày, khác cấp 2 vốn
// chỉ bày buổi của MỘT lớp. Vì gộp nhiều lớp nên cột **Giáo viên phụ trách** mới có
// nghĩa — ở cấp 2 nó là cùng một người trên mọi dòng, còn ở đây nó chính là thứ người
// duyệt cần để biết đi đòi ai.
//
// SERVER COMPONENT — không state, không handler: mọi dòng là một `<Link>` sang đúng bảng
// điểm danh của buổi. Cố ý không dùng `PhanTrangBang` (cắt ở client): lượt quét có thể ra
// hàng nghìn buổi, đẩy hết xuống trình duyệt rồi mới cắt là tự bắn vào chân mình. Trang
// cắt ở SERVER, điều hướng bằng đường dẫn nên bấm F5 / chia sẻ link vẫn đúng trang.
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { AttendanceQueuePhase } from "@/lib/lms/attendance-queue";
import { sessionNumberLabel } from "@/lib/lms/session-order";
import type {
  SessionGapCenterCounts,
  SessionGapCounts,
  SessionGapRow,
} from "@/lib/dashboard/tuong-tac/session-gaps";

const TZ = "Asia/Ho_Chi_Minh";
const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: TZ,
});
const clockFmt = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

const PHASE_TONE: Record<AttendanceQueuePhase, PillTone> = {
  PENDING: "warning",
  TODAY: "info",
  UPCOMING: "muted",
  DONE: "success",
  NO_ROSTER: "muted",
  CANCELLED: "muted",
};

/** Chip một việc: xong = xanh, chưa xong = cam. Nhãn luôn kèm số để đọc được lý do. */
function WorkChip({ done, label }: { done: boolean; label: string }) {
  return (
    <StatusPill tone={done ? "success" : "warning"}>
      {done ? "✓ " : ""}
      {label}
    </StatusPill>
  );
}

function StatCard({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "rounded-xl border border-border bg-primary-soft p-4"
          : "rounded-xl border border-border bg-card p-4"
      }
    >
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-3xl font-black text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SessionGapList({
  rows,
  counts,
  byCenter,
  centerNameOf,
  total,
  page,
  pageCount,
  truncated,
  rangeLabel,
  hrefForPage,
}: {
  rows: SessionGapRow[];
  counts: SessionGapCounts;
  byCenter: SessionGapCenterCounts[] | null;
  /** id cơ sở → tên, để cột "Cơ sở" không hiện chuỗi id. */
  centerNameOf: Record<string, string>;
  total: number;
  page: number;
  pageCount: number;
  truncated: boolean;
  rangeLabel: string;
  /** Dựng đường dẫn giữ nguyên bộ lọc, chỉ đổi số trang. */
  hrefForPage: (page: number) => string;
}) {
  const showCenter = Object.keys(centerNameOf).length > 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-foreground sm:text-3xl">
          <ClipboardCheck className="h-7 w-7 shrink-0 text-primary" />
          Buổi học &amp; đánh giá còn thiếu
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Khoảng ngày: {rangeLabel}. Một buổi chỉ tính là hoàn tất khi đã điểm danh đủ
          lớp, nhận xét đủ học viên đi học và có ảnh/video của các em đi học.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          strong
          label="Còn nợ việc"
          value={counts.pending}
          hint={`trên ${counts.scanned} buổi trong khoảng`}
        />
        <StatCard label="Chưa điểm danh" value={counts.missingAttendance} />
        <StatCard label="Chưa đánh giá" value={counts.missingFeedback} />
        <StatCard label="Buổi sắp tới" value={counts.upcoming} hint="chưa tới giờ học" />
      </div>

      {truncated && (
        <p className="rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground">
          Khoảng ngày đang chọn quá rộng — con số là <strong>ít nhất</strong> chừng này.
          Thu hẹp khoảng ngày để có số đủ.
        </p>
      )}

      {byCenter && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className={adminTh}>Cơ sở</th>
                <th className={adminTh}>Còn nợ việc</th>
                <th className={adminTh}>Chưa điểm danh</th>
                <th className={adminTh}>Chưa đánh giá</th>
                <th className={adminTh}>Sắp tới</th>
              </tr>
            </thead>
            <tbody>
              {byCenter.map((c) => (
                <tr key={c.centerId} className={adminTr}>
                  <td className={`${adminTd} font-semibold`}>{c.centerName}</td>
                  <td className={adminTd}>{c.counts.pending}</td>
                  <td className={adminTd}>{c.counts.missingAttendance}</td>
                  <td className={adminTd}>{c.counts.missingFeedback}</td>
                  <td className={adminTd}>{c.counts.upcoming}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border bg-muted p-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            Không có buổi nào còn nợ việc trong khoảng ngày này.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className={adminTh}>Buổi</th>
                  <th className={adminTh}>Lớp</th>
                  {showCenter && <th className={adminTh}>Cơ sở</th>}
                  <th className={adminTh}>Ngày</th>
                  <th className={adminTh}>Giáo viên phụ trách</th>
                  <th className={adminTh}>Trạng thái</th>
                  <th className={adminTh}>Việc còn thiếu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={adminTr}>
                    <td className={`${adminTd} font-semibold`}>
                      <Link
                        href={`/attendance?sessionId=${r.id}&classId=${r.classId}`}
                        className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {sessionNumberLabel(r.number)}
                      </Link>
                    </td>
                    <td className={`${adminTd} max-w-[16rem] truncate`}>
                      <span className="font-semibold text-foreground">{r.className}</span>
                      {r.classCode && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {r.classCode}
                        </span>
                      )}
                    </td>
                    {showCenter && (
                      <td className={adminTd}>
                        {r.centerId ? (centerNameOf[r.centerId] ?? "—") : "—"}
                      </td>
                    )}
                    <td className={adminTd}>
                      {dayFmt.format(r.date)} · {clockFmt.format(r.date)}
                    </td>
                    <td className={adminTd}>
                      {r.teacherName || (
                        <span className="text-muted-foreground">Chưa phân công</span>
                      )}
                      {r.teacherSource === "SUBSTITUTE" && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (dạy thay)
                        </span>
                      )}
                    </td>
                    <td className={adminTd}>
                      <StatusPill tone={PHASE_TONE[r.phase]}>{r.phaseLabel}</StatusPill>
                    </td>
                    <td className={adminTd}>
                      <span className="inline-flex flex-wrap gap-1.5">
                        <WorkChip
                          done={r.attendanceDone}
                          label={`Điểm danh ${r.marked}/${r.roster}`}
                        />
                        <WorkChip done={r.feedbackDone} label="Nhận xét" />
                        <WorkChip
                          done={r.photoDone}
                          label={`Ảnh ${r.photoCovered}/${r.attended}`}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Trang {page}/{pageCount} · {total} buổi
            </span>
            {/* Bản <Link> (SERVER) chứ không phải bản client: `hrefForPage` là một HÀM,
                truyền hàm qua ranh giới Client Component là Next ném lúc chạy. */}
            <DieuHuongTrangLink trang={page} soTrang={pageCount} hrefCua={hrefForPage} />
          </div>
        </>
      )}
    </div>
  );
}
