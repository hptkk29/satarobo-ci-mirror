/**
 * lib/affiliate/ghi-loai-nhan-dau-vao.ts — LUẬT GHI LOẠI ĐỐI TÁC (`AffiliateType`) và NHÃN (`AffiliateTag`), PHẦN THUẦN (AFF-P0b). Không `db`, không đồng hồ.
 *
 * Luật (mỗi dòng có ca ở `ghi-loai-nhan-dau-vao.test.ts`):
 *  · MÃ (`code`): qua `chuanHoaMa` rồi phải khớp `MA_DANH_MUC_RE` (chữ HOA + số + gạch dưới, 3–40) — cùng CHECK `*_code_chk` của migration. Mã BẤT BIẾN: schema SỬA không có ô `code`
 *    (`.strict()` ⇒ gửi `code` lên là bị từ chối chứ không bị lặng lẽ bỏ qua).
 *  · Danh mục do admin tạo ở giao diện — KHÔNG có mã loại/nhãn nào nằm trong mã nguồn; thêm loại mới không sửa code.
 *  · Ngừng ≠ xoá: không có hàm xoá. Ngừng đòi lý do ≥ 10 ký tự (đối tác MỚI không chọn được nữa; đối tác cũ giữ nguyên). Bật lại không đòi lý do.
 *  · `requiresApproval` và `sortOrder` KHÔNG có mặc định ở đây (luật 7): chỗ gọi phải khai — đổi `requiresApproval` quyết đối tác MỚI vào PENDING hay ACTIVE.
 */
import { z } from "zod";
import { MA_DANH_MUC_RE, chuanHoaMa } from "./chung";

export const LY_DO_TOI_THIEU_LOAI_NHAN = 10;

/** Câu lỗi tiếng Việt cho mã danh mục ĐÃ chuẩn hoá; `null` = hợp lệ. */
export function kiemMaDanhMuc(ma: string): string | null {
  if (MA_DANH_MUC_RE.test(ma)) return null;
  if (ma.length < 3 || ma.length > 40) return `Mã cần 3–40 ký tự (hiện ${ma.length}).`;
  return "Mã chỉ gồm chữ HOA không dấu, chữ số và gạch dưới (A–Z, 0–9, _).";
}

const maDanhMuc = z.string("Nhập mã.").transform(chuanHoaMa).superRefine((ma, ctx) => {
  const loi = kiemMaDanhMuc(ma);
  if (loi) ctx.addIssue({ code: "custom", message: loi });
});

const moTa = z
  .string()
  .trim()
  .max(500, "Mô tả tối đa 500 ký tự.")
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const idTuyChon = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const ten = z.string().trim().min(2, "Tên tối thiểu 2 ký tự.").max(80, "Tên tối đa 80 ký tự.");

// ── Loại ──────────────────────────────────────────────────────────────────────────────────────────

const truongLoai = {
  name: ten,
  description: moTa,
  /** Nguồn mặc định khi campaign không nói gì. Rỗng ⇒ đối tác loại này phải do campaign quy nguồn, không thì XEM TAY. */
  defaultSourceGroupId: idTuyChon,
  requiresApproval: z.boolean("Chọn có cần duyệt hay không."),
  /** L3a — đối tác loại này có thấy SỐ TIỀN hoa hồng ở cổng không: null/không khai = ẨN (mặc định an toàn); campaign khai tường minh thì THẮNG. `undefined` khi sửa = không đổi. */
  partnerCanViewAmount: z.boolean().nullable().optional(),
  sortOrder: z.number("Thứ tự là một số.").int("Thứ tự là số nguyên.").min(0, "Thứ tự từ 0 đến 9999.").max(9999, "Thứ tự từ 0 đến 9999."),
};

export const taoLoaiSchema = z.object({ code: maDanhMuc, ...truongLoai }).strict();
export type DauVaoTaoLoai = z.infer<typeof taoLoaiSchema>;

/** Sửa: KHÔNG có `code` — mã không đổi sau khi tạo. */
export const suaLoaiSchema = z.object(truongLoai).strict();
export type DauVaoSuaLoai = z.infer<typeof suaLoaiSchema>;

// ── Nhãn ──────────────────────────────────────────────────────────────────────────────────────────

const truongNhan = { name: ten, description: moTa };

export const taoNhanSchema = z.object({ code: maDanhMuc, ...truongNhan }).strict();
export type DauVaoTaoNhan = z.infer<typeof taoNhanSchema>;

export const suaNhanSchema = z.object(truongNhan).strict();
export type DauVaoSuaNhan = z.infer<typeof suaNhanSchema>;

// ── Ngừng / bật lại ───────────────────────────────────────────────────────────────────────────────

export type KetQuaKiemBatTat = { ok: true } | { ok: false; loi: string };

/** Cổng ngừng/bật lại: ngừng đòi lý do ≥ 10 ký tự (sau trim), bật lại thì không; đang ở đúng trạng thái đích ⇒ không làm gì cả. */
export function kiemBatTatDanhMuc(p: { dangBat: boolean; batLai: boolean; lyDo: string | null }): KetQuaKiemBatTat {
  if (p.dangBat === p.batLai) return { ok: false, loi: p.batLai ? "Mục này đang hoạt động rồi." : "Mục này đã ngừng rồi." };
  if (!p.batLai && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_LOAI_NHAN) {
    return { ok: false, loi: `Nhập lý do từ ${LY_DO_TOI_THIEU_LOAI_NHAN} ký tự.` };
  }
  return { ok: true };
}
