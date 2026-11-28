import { z } from "zod";

/**
 * WORKSTREAM A — GIỎ HÀNG KHOÁ ONLINE: đơn vị mua là CẶP (khoá × học viên). THUẦN — không DB.
 *
 * Luật (mỗi cái có ca `[OCK-*]`):
 * 1. Bắt buộc chọn CON cho từng dòng — không có "mua cho tài khoản" (quyền học thuộc từng học viên, D-31/hợp đồng mục 2).
 * 2. Một cặp (khoá × học viên) chỉ MỘT lần trong giỏ. Cùng khoá cho hai con ⇒ hai dòng, hợp lệ.
 * 3. Trần số dòng mỗi đơn — chống payload khổng lồ và đơn khó đối soát.
 * 4. `voucherId` (tuỳ chọn) tối đa MỘT mã cho mỗi dòng — "một văn bản một mã" của khuyến mãi được kiểm lại ở máy chủ.
 *
 * Giá, kỳ hạn, tên khoá KHÔNG nằm trong giỏ: máy chủ tự đọc từ `OnlCourse` (client không cầm số tiền nào).
 */

export const TOI_DA_DONG_GIO_HANG = 20;

export const dongGioHangSchema = z
  .object({
    courseId: z.string().trim().min(1, "Thiếu khoá học"),
    studentId: z.string().trim().min(1, "Hãy chọn con cần học khoá này"),
    voucherId: z.string().trim().min(1).nullish(),
    /** Mã khuyến mãi người dùng GÕ (chữ) — máy chủ tra ra voucherId; không gửi cùng `voucherId`. */
    maGiamGia: z.string().trim().min(1).max(40).nullish(),
  })
  .strict();

export const gioHangSchema = z.array(dongGioHangSchema).min(1, "Giỏ hàng trống").max(TOI_DA_DONG_GIO_HANG, `Mỗi đơn tối đa ${TOI_DA_DONG_GIO_HANG} khoá`);

export type DongGioHang = { courseId: string; studentId: string; voucherId: string | null; maGiamGia: string | null };

export type MaLoiGioHang = "GIO_RONG" | "QUA_NHIEU_DONG" | "THIEU_HOC_VIEN" | "THIEU_KHOA" | "TRUNG_CAP_KHOA_HOC_VIEN" | "DU_LIEU_SAI";

export type KetQuaGioHang = { ok: true; dong: DongGioHang[] } | { ok: false; ma: MaLoiGioHang; thongBao: string; viTri?: number };

/** Chuẩn hoá + kiểm giỏ. `raw` là dữ liệu client gửi (không tin kiểu). */
export function kiemGioHang(raw: unknown): KetQuaGioHang {
  if (!Array.isArray(raw)) return { ok: false, ma: "DU_LIEU_SAI", thongBao: "Giỏ hàng không hợp lệ" };
  if (raw.length === 0) return { ok: false, ma: "GIO_RONG", thongBao: "Giỏ hàng trống" };
  if (raw.length > TOI_DA_DONG_GIO_HANG) return { ok: false, ma: "QUA_NHIEU_DONG", thongBao: `Mỗi đơn tối đa ${TOI_DA_DONG_GIO_HANG} khoá` };

  // Báo ĐÚNG dòng thiếu (thiếu con ≠ thiếu khoá) trước khi chạy zod — thông báo của zod không nói dòng thứ mấy.
  for (const [i, d] of raw.entries()) {
    const o = (d ?? {}) as Record<string, unknown>;
    if (typeof o.courseId !== "string" || o.courseId.trim() === "") return { ok: false, ma: "THIEU_KHOA", thongBao: `Dòng ${i + 1}: thiếu khoá học`, viTri: i };
    if (typeof o.studentId !== "string" || o.studentId.trim() === "") return { ok: false, ma: "THIEU_HOC_VIEN", thongBao: `Dòng ${i + 1}: hãy chọn con cần học khoá này`, viTri: i };
  }
  const p = gioHangSchema.safeParse(raw);
  if (!p.success) return { ok: false, ma: "DU_LIEU_SAI", thongBao: p.error.issues[0]?.message ?? "Giỏ hàng không hợp lệ" };

  const dong: DongGioHang[] = p.data.map((d) => ({ courseId: d.courseId, studentId: d.studentId, voucherId: d.voucherId ?? null, maGiamGia: d.maGiamGia ?? null }));
  const gap = new Set<string>();
  for (const [i, d] of dong.entries()) {
    const k = `${d.courseId}\u0000${d.studentId}`;
    if (gap.has(k)) return { ok: false, ma: "TRUNG_CAP_KHOA_HOC_VIEN", thongBao: `Dòng ${i + 1}: khoá này đã có trong giỏ cho cùng một con`, viTri: i };
    gap.add(k);
  }
  return { ok: true, dong };
}
