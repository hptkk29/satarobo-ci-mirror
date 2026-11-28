import { getStudentSchedule, type ScheduleSession as BuoiNguon } from "@/lib/portal/schedule";

import type { MaHocVienDaKiem } from "../so-huu";

/**
 * `GET /students/:id/schedule` — dùng lại `getStudentSchedule` của web (cùng nguồn với trang Lịch học của cổng phụ huynh; nhãn ngày / thứ / "hôm nay"
 * tính sẵn theo lịch Việt Nam). Chỉ nhận `MaHocVienDaKiem` (đã qua `kiemHocVienCuaPhuHuynh`).
 *
 * Bỏ khỏi phản hồi: `order`, `dateISO` thô, `attended` (điểm danh từng buổi thuộc màn Tiến độ), `ngoaiPhamVi` / `nhanPhamVi`, `rate`, `done`, `total`, `remaining`.
 * Trạng thái: nguồn trả `SCHEDULED` | `CANCELLED`; mọi giá trị khác coi là dự kiến (KHÔNG bịa trạng thái "đã đổi lịch").
 */
export type BuoiLichDto = {
  id: string;
  title: string;
  nhan: string;
  nhanNgay: string;
  nhanThu: string;
  homNay: boolean;
  time: string;
  room: string | null;
  teacher: string | null;
  trangThai: "du-kien" | "huy";
};

export type LichDto = {
  courseName: string | null;
  className: string | null;
  next: BuoiLichDto | null;
  thisWeek: BuoiLichDto[];
  upcoming: BuoiLichDto[];
};

const buoi = (b: BuoiNguon): BuoiLichDto => ({
  id: b.id,
  title: b.title,
  nhan: b.nhan,
  nhanNgay: b.nhanNgay,
  nhanThu: b.nhanThu,
  homNay: b.homNay,
  time: b.time,
  room: b.room,
  teacher: b.teacher,
  trangThai: b.status === "CANCELLED" ? "huy" : "du-kien",
});

/** `null` khi học viên không còn tồn tại giữa lúc kiểm và lúc đọc (route trả 404). */
export async function layLich(hocVienId: MaHocVienDaKiem, now: Date = new Date()): Promise<LichDto | null> {
  const l = await getStudentSchedule(hocVienId, now);
  if (!l) return null;
  return {
    courseName: l.courseName,
    className: l.className,
    next: l.next ? buoi(l.next) : null,
    thisWeek: l.thisWeek.map(buoi),
    upcoming: l.upcoming.map(buoi),
  };
}
