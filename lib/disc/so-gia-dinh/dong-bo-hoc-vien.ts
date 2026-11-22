/**
 * ĐỒNG BỘ SỔ GIA ĐÌNH DISC ↔ HỒ SƠ CON (14/11/2026, chủ dự án chốt: nhập một nơi thì các nơi khác tự có).
 *
 * Một thành viên của Sổ có thể NỐI với một học viên (`DiscThanhVien.studentId`, do CHÍNH phụ huynh chọn). Hai bên cùng giữ LỚP và
 * NĂM SINH của bé; phụ huynh sửa một bên thì bên kia đổi theo — chỉ hai ô đó, vì:
 *  · TÊN: không đồng bộ. Tên học viên là tên chính thức (mã, hoá đơn, giấy tờ) mà phụ huynh không sửa được ở cổng; tên trong Sổ là tên GỌI
 *    (≤ 30 ký tự, có thể «Bống»). Đồng bộ là biến biệt danh thành tên trên hoá đơn, hoặc tên chính thức thành biệt danh.
 *  · NGÀY SINH: Sổ chỉ biết NĂM. Chiều Sổ → học viên không thể bịa ra ngày/tháng; chiều học viên → Sổ lấy năm.
 *
 * LUẬT RIÊNG TƯ (PRD DISC: nhân viên không có đường đọc dữ liệu DISC):
 *  · Chiều học viên → Sổ chỉ chạy từ đường do PHỤ HUYNH tự sửa hồ sơ con (`lib/portal/child-detail.ts`). Màn sửa học viên của admin
 *    (`lib/students/ghi-ho-so.ts`) KHÔNG ghi vào bảng DISC — lưới `[DBL-W16]` canh. Nhân viên đổi lớp của bé thì Sổ giữ nguyên.
 *  · Chiều Sổ → học viên đi qua `ghiHoSoTrongTx` (cùng đường với cổng PH) nên tự dội tiếp sang phiếu lead/anh chị em; nó chỉ nhận MỘT ô (lớp).
 *  · Chỉ chạy khi giá trị ĐỔI THẬT ở bên nguồn: lưu lại một thành viên với lớp cũ KHÔNG đè lớp mà nhân viên/phụ huynh vừa sửa ở bên kia.
 *
 * Phần THUẦN (không DB) để test không cần Postgres; phần ghi nhận `tx` của bên gọi (cùng một giao dịch với phép ghi gốc).
 */
import type { Prisma } from "@prisma/client";

import { ngayVN } from "./kieu";

/** «1»…«12» → số lớp; «mam-non» / «tren-12» / rỗng ⇒ null (học viên không có ô tương ứng). */
export function lopSangKhoi(lop: string | null | undefined): number | null {
  if (!lop || !/^\d{1,2}$/.test(lop)) return null;
  const n = Number(lop);
  return n >= 1 && n <= 12 ? n : null;
}

export function khoiSangLop(khoi: number | null | undefined): string | null {
  return typeof khoi === "number" && Number.isInteger(khoi) && khoi >= 1 && khoi <= 12 ? String(khoi) : null;
}

/** Năm (múi giờ VN) của một mốc ngày sinh; null ⇒ null. */
export function namCuaNgaySinh(d: Date | null | undefined): number | null {
  return d ? Number(ngayVN(d).slice(0, 4)) : null;
}

/**
 * Chiều Sổ → học viên: phụ huynh vừa lưu thành viên ĐÃ NỐI. Chỉ trả `currentGrade` khi lớp trong Sổ ĐỔI, là lớp 1–12 và khác lớp của học viên.
 */
export function keHoachSoSangHocVien(p: { lopTruoc: string | null; lopMoi: string | null; khoiHocVien: number | null }): { currentGrade: number } | null {
  if (p.lopMoi === p.lopTruoc) return null;
  const khoi = lopSangKhoi(p.lopMoi);
  if (khoi === null || khoi === p.khoiHocVien) return null;
  return { currentGrade: khoi };
}

/**
 * Chiều học viên → Sổ: phụ huynh vừa sửa hồ sơ con. Chỉ ô ĐỔI THẬT mới được đẩy; ô bị xoá trắng ở hồ sơ không xoá ở Sổ (Sổ có thể đang
 * giữ lớp/năm sinh do chính phụ huynh khai).
 */
export function keHoachHocVienSangSo(p: {
  truoc: { currentGrade: number | null; dateOfBirth: Date | null };
  sau: { currentGrade: number | null; dateOfBirth: Date | null };
}): { lop?: string; namSinh?: number } {
  const ra: { lop?: string; namSinh?: number } = {};
  const lop = khoiSangLop(p.sau.currentGrade);
  if (p.sau.currentGrade !== p.truoc.currentGrade && lop !== null) ra.lop = lop;
  const namTruoc = namCuaNgaySinh(p.truoc.dateOfBirth);
  const namSau = namCuaNgaySinh(p.sau.dateOfBirth);
  if (namSau !== null && namSau !== namTruoc) ra.namSinh = namSau;
  return ra;
}

/**
 * Đẩy lớp/năm sinh mới của học viên sang MỌI thành viên Sổ đã nối học viên đó (thường 0 hoặc 1). Trả số thành viên đã sửa.
 * `tx` phải là giao dịch của bên gọi; bảng DISC không theo cơ sở nên không cần scope.
 */
export async function dayHocVienSangSo(
  tx: Prisma.TransactionClient,
  studentId: string,
  p: Parameters<typeof keHoachHocVienSangSo>[0],
): Promise<number> {
  const data = keHoachHocVienSangSo(p);
  if (data.lop === undefined && data.namSinh === undefined) return 0;
  const r = await tx.discThanhVien.updateMany({ where: { studentId, deletedAt: null }, data });
  return r.count;
}
