// Tab "Điểm danh" của buổi dạy thay. TÁI DÙNG nguyên `AttendancePanel` + `saveClassAttendanceAction` của giáo viên
// chính — một đường ghi duy nhất vào `Attendance`, nên admin và giáo viên chính thấy kết quả ngay và công dạy thay
// (`completeSession` gán người thực dạy = người dạy thay) đi đúng đường cũ.
import type { Actor } from "@/lib/auth/actor";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import { loiKhongPhaiNguoiDay } from "@/lib/lms/session-ownership";
import { dauNgayVn, type ChiTietDayThay } from "@/lib/teachers/day-thay";
import { AttendancePanel, type AttendancePanelRow } from "../../lop/_components/attendance-panel";

const NGAY_MS = 24 * 60 * 60 * 1000;

export async function TabDiemDanh({ ct, actor, userId, now }: { ct: ChiTietDayThay; actor: Actor; userId: string; now: Date }) {
  const { rows } = await buildSessionAttendanceRows(actor, ct.id);
  // Cùng hàm với server (`saveClassAttendanceAction`) ⇒ nút hiện ⇔ server nhận (luật 12).
  const lyDoChiXem = loiKhongPhaiNguoiDay(userId, ct.sohuu, "điểm danh");
  const panelRows: AttendancePanelRow[] = rows.map((r) => ({
    studentId: r.studentId,
    studentName: r.studentName,
    enrollmentStatus: r.enrollmentStatus,
    makeupFromCenter: r.makeupFromCenter ?? null,
    existingStatus: r.existing?.status ?? null,
    existingNote: r.existing?.note ?? null,
    chuaToiLuot: r.chuaToiLuot,
    ketQuaBu: r.ketQuaBu?.nhan ?? null,
  }));
  // Buổi TƯƠNG LAI không mở điểm danh — chặn ghi trước + tránh báo phụ huynh buổi chưa diễn ra (cùng cổng hub lớp).
  const daToiNgay = ct.date.getTime() < dauNgayVn(now).getTime() + NGAY_MS;
  const choPhep = ct.status !== "CANCELLED" && daToiNgay && lyDoChiXem === null;

  return (
    <div className="space-y-3">
      {lyDoChiXem && (
        <div
          role="alert"
          className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink"
        >
          {lyDoChiXem}
        </div>
      )}
      {!daToiNgay && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Buổi này chưa tới ngày dạy nên chưa mở điểm danh. Xem học viên và giáo án để chuẩn bị.
        </p>
      )}
      <AttendancePanel sessionId={ct.id} rows={panelRows} editable={choPhep} />
    </div>
  );
}
