// Tab "Học viên" của buổi dạy thay: ai sẽ ngồi trong lớp, buổi này em đã được ghi gì, và lần trước giáo viên
// nhận xét em ra sao. Đọc roster qua `buildSessionAttendanceRows` — CÙNG hàm với điểm danh của giáo viên chính
// (bảo lưu / học bù liên cơ sở / chưa tới lượt xử lý ở đó), nên danh sách ở đây và ở màn điểm danh không thể lệch.
// ⚠️ Câu 46: CHỈ tên học viên — không SĐT / email / tên phụ huynh.
import type { Actor } from "@/lib/auth/actor";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import { getSessionBirthdays } from "@/lib/students/birthday";
import { docNhanXetBuoiTruoc, type ChiTietDayThay } from "@/lib/teachers/day-thay";
import { initialsOf } from "@/lib/ui/initials";
import { cn } from "@/lib/utils";
import { EmptyState } from "../../_components/ui/empty-state";
import { BirthdayBanner } from "../../lop/_components/birthday-banner";

const ngayFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

const TRANG_THAI: Record<string, { nhan: string; cls: string }> = {
  PRESENT: { nhan: "Có mặt", cls: "bg-state-success-soft text-state-success-ink" },
  LATE: { nhan: "Đi trễ", cls: "bg-state-warning-soft text-state-warning-ink" },
  EXCUSED: { nhan: "Vắng có phép", cls: "bg-state-info-soft text-state-info-ink" },
  ABSENT_EXCUSED: { nhan: "Vắng có phép", cls: "bg-state-info-soft text-state-info-ink" },
  ABSENT: { nhan: "Vắng", cls: "bg-state-danger-soft text-state-danger-ink" },
  ABSENT_UNEXCUSED: { nhan: "Vắng", cls: "bg-state-danger-soft text-state-danger-ink" },
};

export async function TabHocVien({ ct, actor }: { ct: ChiTietDayThay; actor: Actor }) {
  const [{ rows }, birthdays] = await Promise.all([
    buildSessionAttendanceRows(actor, ct.id),
    getSessionBirthdays(ct.id),
  ]);
  const truoc = await docNhanXetBuoiTruoc(
    ct,
    rows.map((r) => r.studentId),
  );

  return (
    <div className="space-y-5">
      <BirthdayBanner items={birthdays} />

      <section aria-label="Danh sách học viên">
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Học viên của buổi <span className="font-normal text-muted-foreground">· {rows.length}</span>
        </h2>
        {rows.length === 0 ? (
          <EmptyState title="Lớp chưa có học viên đang học." description="Nếu không đúng, báo quản lý cơ sở kiểm tra danh sách lớp." />
        ) : (
          <ul className="t-card divide-y divide-border overflow-hidden">
            {rows.map((r) => {
              const tt = r.existing ? TRANG_THAI[r.existing.status] : undefined;
              const lanTruoc = truoc.get(r.studentId);
              return (
                <li key={r.studentId} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink"
                    aria-hidden
                  >
                    {initialsOf(r.studentName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{r.studentName}</p>
                    {r.makeupFromCenter && (
                      <p className="text-xs text-muted-foreground">Học bù từ {r.makeupFromCenter}</p>
                    )}
                    {r.chuaToiLuot && <p className="text-xs text-state-warning-ink">{r.chuaToiLuot}</p>}
                    {lanTruoc ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="tabular-nums">Buổi {ngayFmt.format(lanTruoc.date)}:</span>{" "}
                        <span className="line-clamp-2">{lanTruoc.comment}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Chưa có nhận xét buổi trước.</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                      tt?.cls ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {tt?.nhan ?? "Chưa điểm danh"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
