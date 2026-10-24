// lib/bao-luu/ca-cu.ts — CA "BẢO LƯU CŨ" CHƯA CÓ HỒ SƠ (nhóm (b) của `docs/bao-luu/legacy-3-nhom.sql`). THUẦN, không DB. PHIÊN 7.
//
// Ghi danh `PAUSED` mà KHÔNG có hồ sơ `StudentReserve` còn hiệu lực phủ nó: ca đi ĐƯỜNG TẮT (dialog đổi trạng thái / form / Excel). Hệ thống không
// biết họ nghỉ từ khi nào, đến khi nào, ai cho nghỉ, có đơn không. Module này CHỈ ĐO và liệt kê — KHÔNG tự lập hồ sơ LEGACY:
// BR-07 bắt buộc đơn đã ký (chỉ người cầm tờ giấy mới tải lên được) và BR-28 tính hạn từ ngày hiệu lực quy chế, nên một lệnh hàng loạt sẽ
// bịa ra ngày bắt đầu / hạn / đơn. Xem CAN-QUYET K14.
//
// Ngày bắt đầu ƯỚC TÍNH = lần cuối ghi danh được chuyển sang PAUSED trong `EnrollmentAuditLog`; không có dòng nào thì lùi về `updatedAt`
// của ghi danh và đánh dấu `nguonNgay = "CAP_NHAT"` — con số kém tin hơn, người đọc phải biết.

import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";

export type CaCuTho = {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  centerId: string | null;
  tenKhoa: string;
  tenLop: string;
  /** Lần cuối chuyển sang PAUSED theo nhật ký; `null` nếu không có dòng nào. */
  pausedTheoNhatKy: Date | null;
  /** `Enrollment.updatedAt` — chỗ lùi khi không có nhật ký. */
  capNhatLuc: Date;
};

export type HoSoPhu = { studentId: string; enrollmentId: string | null };

export type CaCu = CaCuTho & {
  tuNgay: Date;
  nguonNgay: "NHAT_KY" | "CAP_NHAT";
  han: Date;
  quaHan: boolean;
  /** Số ngày đã qua hạn (0 nếu chưa quá). */
  soNgayQuaHan: number;
};

const NGAY_MS = 86_400_000;

/**
 * Hồ sơ còn hiệu lực có phủ ghi danh này không: cùng `enrollmentId`, HOẶC hồ sơ dòng cũ `enrollmentId = NULL` của cùng học viên
 * (đúng định nghĩa nhóm (b) trong `legacy-3-nhom.sql`). Truyền vào CHỈ những hồ sơ còn hiệu lực (`isActive`, chưa `endedAt`).
 */
export function daCoHoSoPhu(ca: Pick<CaCuTho, "enrollmentId" | "studentId">, hoSo: readonly HoSoPhu[]): boolean {
  return hoSo.some((h) => h.enrollmentId === ca.enrollmentId || (h.enrollmentId === null && h.studentId === ca.studentId));
}

/** Lọc ca chưa có hồ sơ phủ rồi gắn ngày ước tính + hạn. Sắp xếp quá hạn lâu nhất lên đầu. `now` BẮT BUỘC (luật 19). */
export function phanLoaiCaCu(p: { ca: readonly CaCuTho[]; hoSoConHieuLuc: readonly HoSoPhu[]; maxMonths: number; now: Date }): CaCu[] {
  const ra: CaCu[] = [];
  for (const c of p.ca) {
    if (daCoHoSoPhu(c, p.hoSoConHieuLuc)) continue;
    const tuNgay = c.pausedTheoNhatKy ?? c.capNhatLuc;
    const han = hanToiDaBaoLuu(tuNgay, p.maxMonths);
    const quaMs = p.now.getTime() - han.getTime();
    ra.push({
      ...c,
      tuNgay,
      nguonNgay: c.pausedTheoNhatKy ? "NHAT_KY" : "CAP_NHAT",
      han,
      quaHan: quaMs > 0,
      soNgayQuaHan: quaMs > 0 ? Math.floor(quaMs / NGAY_MS) : 0,
    });
  }
  return ra.sort((a, b) => b.soNgayQuaHan - a.soNgayQuaHan || a.tuNgay.getTime() - b.tuNgay.getTime() || a.enrollmentId.localeCompare(b.enrollmentId));
}

/** Tóm tắt cho báo cáo — đếm theo cơ sở. */
export function demTheoCoSo(ca: readonly CaCu[]): { centerId: string | null; tong: number; quaHan: number; khongCoNhatKy: number }[] {
  const m = new Map<string | null, { centerId: string | null; tong: number; quaHan: number; khongCoNhatKy: number }>();
  for (const c of ca) {
    const x = m.get(c.centerId) ?? { centerId: c.centerId, tong: 0, quaHan: 0, khongCoNhatKy: 0 };
    x.tong += 1;
    if (c.quaHan) x.quaHan += 1;
    if (c.nguonNgay === "CAP_NHAT") x.khongCoNhatKy += 1;
    m.set(c.centerId, x);
  }
  return [...m.values()].sort((a, b) => String(a.centerId).localeCompare(String(b.centerId)));
}
