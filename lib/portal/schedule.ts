import "server-only";
import { db } from "@/lib/db";
import { sessionTimeRange } from "@/lib/classes/slots";
import { attendanceRatePercent } from "@/lib/lms/report-card-core";
import { chonMocBuoi, demBuoi, napBuoiCuaLop, type BuoiHoc } from "@/lib/portal/buoi-hoc";
import { getStudentAttendanceSummaries, getStudentClasses } from "@/lib/portal/learning";
import { vnAddDays, vnStartOfDay, vnWeekday } from "@/lib/time/vn";

// Portal v2 — dữ liệu trang Lịch học (1 con đang chọn). Ownership: caller truyền studentId
// đã verify (requireActiveStudent). KHÔNG nhận studentId qua URL.
//
// ─────────────────────────────────────────────────────────────────────────────
// Viết lại 06/09/2026 — bốn khiếm khuyết đo được, mỗi cái tự nó làm phụ huynh đọc sai
//
// 1. **CHỈ MỘT LỚP.** Bản cũ dùng `enrollment.findFirst(... orderBy createdAt desc)`, nên
//    học viên học nhiều lớp chỉ thấy lịch của lớp ghi danh gần nhất. Đo trên DB làm việc
//    06/09: **77/170 học viên đang học ≥2 lớp** — gần một nửa khách hàng mất hẳn lịch của
//    một lớp có thật. Bản v1 (`/portal/lich-hoc` → `lib/portal/learning.ts`) vốn đã đúng
//    nhiều lớp; v2 — thứ prod đang chạy — là bước LÙI.
//
// 2. **Số buổi lấy từ `Lesson.order`.** Xem khối chú thích đầu `lib/portal/buoi-hoc.ts`:
//    huỷ buổi rồi xếp bù đẻ ra hai buổi cùng `Lesson.order`, và buổi chưa gắn giáo án thì
//    không có số. Nay đi qua `napBuoiCuaLop` — cùng bảng tra mà site giáo viên và admin dùng.
//
// 3. **Chuyên cần / "đã học" tự tính một kiểu riêng.** Bản cũ: `rate = có mặt / số DÒNG
//    điểm danh`, `done = số buổi có ngày < bây giờ`. Trang chủ phụ huynh thì tính qua
//    `getStudentAttendanceSummaries` → hai màn cạnh nhau in hai con số khác nhau cho cùng
//    một đứa trẻ. Nay cả hai màn dùng CHUNG một nguồn.
//
// 4. **Mốc thời gian theo TZ máy chạy.** `startOfWeek` cũ dùng `getDay()/setHours()`;
//    Vercel chạy UTC nên "tuần này" lệch 7 giờ, và nhãn ngày do component tự format
//    (`getDate()`) sai hẳn một ngày trong khoảng 00:00–07:00 giờ VN — đúng giờ phụ huynh
//    xem lịch trước khi đưa con đi học. Nay mọi nhãn ngày/thứ tính sẵn ở server theo
//    lịch VN (`BuoiHoc.nhanNgay/nhanThu/homNay`).
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduleSession = {
  id: string;
  /** Buổi thứ mấy CỦA LỚP ĐÓ — khớp site giáo viên/admin. */
  order: number | null;
  /** Tên bài TRẦN; `Buổi học` khi lớp chưa ghim giáo trình. */
  title: string;
  /** Nhãn đầy đủ `Buổi 5 - HP2 - Họa Sĩ Robot` — cho chỗ không có huy hiệu số buổi. */
  nhan: string;
  /** Lớp nào — hiện ra khi con học nhiều lớp. */
  className: string | null;
  dateISO: string;
  /** Nhãn ngày/thứ tính sẵn theo lịch VN (đừng format lại ở component). */
  nhanNgay: string;
  nhanNgayNgan: string;
  nhanThu: string;
  homNay: boolean;
  time: string;
  room: string | null;
  teacher: string | null;
  status: string;
  attended: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | null;
};

export type StudentSchedule = {
  studentName: string;
  /** Gộp mọi khoá đang học, `A · B`. */
  courseName: string | null;
  /** Gộp mọi lớp đang học, `CS1.LAPTRI.006 · CS1.ROBOSIM.002`. */
  className: string | null;
  /** % chuyên cần — CÙNG công thức với trang chủ phụ huynh và học bạ. */
  rate: number;
  /** Buổi đã diễn ra / tổng buổi — cũng cùng nguồn với trang chủ. */
  done: number;
  total: number;
  remaining: number;
  next: ScheduleSession | null;
  thisWeek: ScheduleSession[];
  upcoming: ScheduleSession[];
};

const TRONG: Omit<StudentSchedule, "studentName"> = {
  courseName: null,
  className: null,
  rate: 0,
  done: 0,
  total: 0,
  remaining: 0,
  next: null,
  thisWeek: [],
  upcoming: [],
};

/** Đầu tuần (thứ Hai 00:00 giờ VN) chứa `d`. */
function dauTuanVn(d: Date): Date {
  const lui = (vnWeekday(d) + 6) % 7; // CN=0 → lùi 6 ngày
  return vnStartOfDay(vnAddDays(d, -lui));
}

export async function getStudentSchedule(studentId: string): Promise<StudentSchedule | null> {
  const [student, lopDangHoc] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { name: true } }),
    getStudentClasses(studentId),
  ]);
  if (!student) return null;
  if (lopDangHoc.length === 0) return { studentName: student.name, ...TRONG };

  const classIds = lopDangHoc.map((c) => c.id);
  const now = new Date();

  const [lopChiTiet, buoiList, attendance, chuyenCan] = await Promise.all([
    db.class.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true,
        classCode: true,
        name: true,
        startTime: true,
        endTime: true,
        teacher: { select: { name: true } },
        room: { select: { name: true } },
        course: { select: { name: true } },
      },
    }),
    napBuoiCuaLop(classIds, now),
    db.attendance.findMany({
      where: { studentId, session: { classId: { in: classIds } } },
      select: { sessionId: true, status: true },
    }),
    // CÙNG nguồn với trang chủ phụ huynh (`getParentChildrenOverview`) và học bạ —
    // không tự chia lại ở đây nữa.
    getStudentAttendanceSummaries(studentId),
  ]);

  const lopCua = new Map(lopChiTiet.map((c) => [c.id, c]));
  const attMap = new Map(
    attendance.map((a) => [a.sessionId, a.status as ScheduleSession["attended"]]),
  );
  const nhieuLop = classIds.length > 1;

  const doiSang = (b: BuoiHoc): ScheduleSession => {
    const cls = lopCua.get(b.classId);
    // Giờ tính THEO TỪNG BUỔI: lớp dùng Kế hoạch lịch học nhiều giai đoạn thì mỗi giai
    // đoạn một khung giờ, một chuỗi `time` chung cho cả khoá là sai từ ngày đổi ca.
    const r = sessionTimeRange(new Date(b.ngayISO), cls?.startTime, cls?.endTime);
    return {
      id: b.id,
      order: b.soBuoi > 0 ? b.soBuoi : null,
      title: b.tieuDe || "Buổi học",
      nhan: b.nhanDayDu || "Buổi học",
      // Chỉ gắn tên lớp khi con học nhiều lớp — một lớp thì tên đã ở tiêu đề trang.
      className: nhieuLop ? cls?.classCode ?? cls?.name ?? null : null,
      dateISO: b.ngayISO,
      nhanNgay: b.nhanNgay,
      nhanNgayNgan: b.nhanNgayNgan,
      nhanThu: b.nhanThu,
      homNay: b.homNay,
      time: r.end ? `${r.start} - ${r.end}` : r.start,
      room: cls?.room?.name ?? null,
      teacher: cls?.teacher?.name ?? null,
      status: b.daHuy ? "CANCELLED" : "SCHEDULED",
      attended: attMap.get(b.id) ?? null,
    };
  };

  // Buổi ĐÃ HUỶ VẪN hiện ở "tuần này" — gắn nhãn huỷ. Giấu đi thì phụ huynh không biết
  // lớp nghỉ và vẫn đưa con tới. Nhưng KHÔNG được chọn làm "buổi kế tiếp" và không nằm
  // trong danh sách "sắp tới": đó là buổi không diễn ra.
  const conSong = buoiList.filter((b) => !b.daHuy);
  const moc = chonMocBuoi(buoiList);
  const dem = demBuoi(buoiList);

  const tuanDau = dauTuanVn(now);
  const tuanCuoi = vnAddDays(tuanDau, 7);
  const trongTuan = buoiList.filter((b) => {
    const t = Date.parse(b.ngayISO);
    return t >= tuanDau.getTime() && t < tuanCuoi.getTime();
  });

  const tong = chuyenCan.reduce(
    (a, s) => ({
      attended: a.attended + s.attended,
      daDienRa: a.daDienRa + s.daDienRa,
    }),
    { attended: 0, daDienRa: 0 },
  );

  const gopTen = (xs: (string | null | undefined)[]) => {
    const u = [...new Set(xs.filter((x): x is string => !!x))];
    return u.length ? u.join(" · ") : null;
  };

  return {
    studentName: student.name,
    courseName: gopTen(lopChiTiet.map((c) => c.course?.name)),
    className: gopTen(lopChiTiet.map((c) => c.classCode ?? c.name)),
    rate: attendanceRatePercent({
      total: 0,
      daDienRa: tong.daDienRa,
      attended: tong.attended,
      absent: 0,
      needMakeup: 0,
      madeUp: 0,
    }),
    done: dem.daDienRa,
    total: dem.tong,
    remaining: dem.conLai,
    next: moc.tiepTheo ? doiSang(moc.tiepTheo) : null,
    thisWeek: trongTuan.map(doiSang),
    upcoming: conSong.filter((b) => !b.daDienRa).slice(0, 8).map(doiSang),
  };
}
