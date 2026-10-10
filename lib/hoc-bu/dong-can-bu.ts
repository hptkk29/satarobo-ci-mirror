// Ghép dữ liệu thô thành đầu vào của `tongLuotBu` — hàm THUẦN (docs/hoc-bu/DAC-TA.md §3.1).
//
// Tách khỏi tệp đọc DB để phép nối "bài học → học phần → lượt" có chỗ cấy lỗi mà không cần
// Postgres. Ba câu hỏi, mỗi câu một hàm:
//   · khoá này chia những học phần nào, mỗi học phần bao nhiêu buổi, mấy lượt;
//   · bé mua bao nhiêu buổi của khoá này;
//   · bé bắt đầu ở học phần nào.

import type { HocPhanKhoa } from "@/lib/hoc-bu/luot-bu";

/** Khoá không chia học phần (Sata 1/2/8 — `moduleCode` null) ⇒ cả khoá là MỘT học phần. */
export const MA_CA_KHOA = "";

export type BaiCuaKhoa = { moduleCode: string | null; order: number };

/**
 * Học phần của khoá theo thứ tự bài. `cauHinh` là lượt đã khai (`CourseModuleMakeupQuota`);
 * học phần chưa khai ⇒ 1 lượt (chốt 29/09: "mỗi học phần 1 buổi").
 */
export function hocPhanCuaKhoa(
  bai: readonly BaiCuaKhoa[],
  cauHinh: ReadonlyMap<string, number>,
): HocPhanKhoa[] {
  const theoThuTu = [...bai].sort((a, b) => a.order - b.order);
  const ra: HocPhanKhoa[] = [];
  const viTri = new Map<string, number>();
  for (const b of theoThuTu) {
    const ma = b.moduleCode?.trim() || MA_CA_KHOA;
    let i = viTri.get(ma);
    if (i === undefined) {
      i = ra.length;
      viTri.set(ma, i);
      ra.push({ moduleCode: ma, soBuoi: 0, luotBu: cauHinh.get(ma) ?? 1 });
    }
    ra[i]!.soBuoi += 1;
  }
  return ra;
}

export type DongDonCuaBe = { courseId: string | null; soBuoi: number | null };

/**
 * Số buổi bé mua của khoá `courseId` = Σ `soBuoi` của các dòng đơn của bé thuộc khoá đó
 * (mua thêm ở đơn sau thì cộng dồn). Không dòng nào khai số buổi ⇒ `macDinh`
 * (`Course.totalSessions`, rồi số bài của khoá) — đúng mặc định mà ô "số buổi mua" tự điền.
 */
export function soBuoiMuaCuaBe(
  dong: readonly DongDonCuaBe[],
  courseId: string,
  macDinh: number,
): number {
  let tong = 0;
  let coKhai = false;
  for (const d of dong) {
    if (d.courseId !== courseId || d.soBuoi === null) continue;
    tong += d.soBuoi;
    coKhai = true;
  }
  return coKhai ? tong : macDinh;
}

/** Học phần của buổi đầu tiên bé học trong lớp. Không biết ⇒ học phần đầu (0). */
export function viTriHocPhanBatDau(
  hocPhan: readonly HocPhanKhoa[],
  moduleCodeBuoiDau: string | null | undefined,
): number {
  if (moduleCodeBuoiDau === undefined) return 0;
  const ma = moduleCodeBuoiDau?.trim() || MA_CA_KHOA;
  const i = hocPhan.findIndex((h) => h.moduleCode === ma);
  return i < 0 ? 0 : i;
}
