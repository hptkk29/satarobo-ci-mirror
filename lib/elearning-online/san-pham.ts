import { z } from "zod";

/**
 * E-LEARNING ONLINE — SẢN PHẨM + KHUNG CHẤM (V10.0, Q6). HÀM THUẦN. Không dùng engine điểm Nội bộ; không giả định giáo viên Offline được chấm Online.
 *
 * Bất biến:
 * 1. Khoá tệp PHẢI nằm dưới `online/sp/<khoá>/<học viên>/` của CHÍNH học viên nộp — không nhận khoá của người khác, không `..`, không URL.
 * 2. Loại tệp (MIME) phải thuộc loại câu hỏi cho phép; vượt dung lượng/thời lượng ⇒ từ chối. Máy chủ KHÔNG tin tên tệp/đuôi tệp do client gửi để suy loại.
 * 3. Điểm theo khung: phải chấm ĐỦ và ĐÚNG tiêu chí (không thừa/thiếu), mỗi tiêu chí số nguyên 0..tối đa; điểm câu = làm tròn XUỐNG theo tỷ lệ.
 */

export const MIME_THEO_LOAI = {
  VIDEO: ["video/mp4", "video/quicktime", "video/webm"],
  IMAGE: ["image/jpeg", "image/png", "image/webp"],
  PDF: ["application/pdf"],
} as const;
export type LoaiTep = keyof typeof MIME_THEO_LOAI;

export const tienToKhoaSanPham = (courseId: string, studentId: string) => `online/sp/${courseId}/${studentId}/`;

export type TepNop = { key: string; name: string; mime: string; sizeBytes: number; durationSec?: number | null };
export type CauHinhSanPham = { accept: LoaiTep[]; maxMb: number; maxVideoSec?: number | null; rubricId?: string | null };

export function kiemTepNop(cfg: CauHinhSanPham, f: TepNop, pham: { courseId: string; studentId: string }): { ok: true } | { ok: false; thongBao: string } {
  const tienTo = tienToKhoaSanPham(pham.courseId, pham.studentId);
  if (typeof f.key !== "string" || !f.key.startsWith(tienTo) || f.key.length <= tienTo.length || f.key.length > 300 || /\.\.|\/\/|\\|\s/.test(f.key.slice(tienTo.length)) || /^https?:/i.test(f.key)) return { ok: false, thongBao: "Khoá tệp không hợp lệ" };
  if (typeof f.name !== "string" || f.name.trim().length === 0 || f.name.length > 200 || /[\\/]/.test(f.name)) return { ok: false, thongBao: "Tên tệp không hợp lệ" };
  const loai = (cfg.accept ?? []).find((l) => (MIME_THEO_LOAI[l] as readonly string[]).includes(f.mime));
  if (!loai) return { ok: false, thongBao: "Loại tệp không được nhận cho câu này" };
  if (!Number.isInteger(f.sizeBytes) || f.sizeBytes <= 0) return { ok: false, thongBao: "Dung lượng tệp không hợp lệ" };
  if (f.sizeBytes > cfg.maxMb * 1024 * 1024) return { ok: false, thongBao: `Tệp vượt ${cfg.maxMb} MB` };
  if (loai === "VIDEO" && cfg.maxVideoSec) {
    if (typeof f.durationSec !== "number" || !Number.isFinite(f.durationSec) || f.durationSec <= 0) return { ok: false, thongBao: "Thiếu thời lượng video" };
    if (f.durationSec > cfg.maxVideoSec) return { ok: false, thongBao: `Video dài quá ${cfg.maxVideoSec} giây` };
  }
  return { ok: true };
}

// ───────── Khung chấm ─────────

export type TieuChi = { id: string; name: string; max: number };

export const khungChamSchema = z
  .object({
    id: z.string().min(1).optional(),
    courseId: z.string().min(1),
    code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,28}[A-Z0-9]$/, "Mã khung chỉ gồm chữ hoa, số và gạch nối (3–30 ký tự)"),
    title: z.string().trim().min(1, "Khung chấm cần tên").max(200),
    criteria: z
      .array(z.object({ id: z.string().trim().regex(/^[a-z0-9_-]{1,30}$/, "Mã tiêu chí chỉ gồm chữ thường, số, gạch"), name: z.string().trim().min(1, "Tiêu chí cần tên").max(200), max: z.number().int().min(1).max(100) }).strict())
      .min(1, "Cần ít nhất một tiêu chí")
      .max(10),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((k) => new Set(k.criteria.map((c) => c.id)).size === k.criteria.length, { message: "Mã tiêu chí bị trùng" });
export type KhungChamInput = z.infer<typeof khungChamSchema>;

export const tongToiDaKhung = (ds: readonly TieuChi[]) => ds.reduce((s, c) => s + c.max, 0);

/** Điểm câu từ điểm từng tiêu chí. Chấm thiếu/thừa tiêu chí, hoặc ngoài [0, max] ⇒ từ chối (không kẹp im lặng — người chấm phải biết mình nhập sai). */
export function tinhDiemSanPham(criteria: readonly TieuChi[], scores: Record<string, unknown>, diemToiDaCau: number): { ok: true; tong: number; toiDa: number; diemCau: number } | { ok: false; thongBao: string } {
  const khoa = Object.keys(scores);
  if (khoa.length !== criteria.length || criteria.some((c) => !(c.id in scores))) return { ok: false, thongBao: "Cần chấm đủ và đúng các tiêu chí của khung" };
  let tong = 0;
  for (const c of criteria) {
    const v = scores[c.id];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > c.max) return { ok: false, thongBao: `Điểm tiêu chí "${c.name}" phải là số nguyên từ 0 đến ${c.max}` };
    tong += v;
  }
  const toiDa = tongToiDaKhung(criteria);
  return { ok: true, tong, toiDa, diemCau: Math.floor((diemToiDaCau * tong) / toiDa) };
}
