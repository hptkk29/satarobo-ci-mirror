import { z } from "zod";

import { laNgayHopLe } from "@/lib/format/thoi-gian-vn";
import { congThangLich } from "@/lib/elearning-online/thoi-han";

import { kiemBan, TOI_DA_BAN, TOI_DA_NGUOI_CONG, type LoiBan } from "./so-cong";

/**
 * V8.39 — LƯU SỨC KHOẺ CÓ CHỦ ĐÍCH LÊN MÁY CHỦ (HL-01, Owner 22/11/2026). THUẦN — không DB, không đồng hồ (ngày «hôm nay» là THAM SỐ), không env (đọc ở lớp mỏng).
 * Dữ liệu = đúng những gì app đã lưu cục bộ: ≤ 6 người nhà × ≤ 3 bản số đo. Người nhà KHÔNG phải `Student` (tên tự gõ) ⇒ không `studentId`.
 * Mọi số đo được kiểm LẠI ở máy chủ bằng `kiemBan` của lõi sức khoẻ (không tin client).
 */

export const MA_DICH_MA_HOA_SUC_KHOE = "suc-khoe.so-do" as const;
export const nguCanhSucKhoe = (parentUserId: string): string => `phuhuynh:${parentUserId}`;

export const THAN_TOI_DA_BYTE_SUC_KHOE = 64 * 1024;
/** Phiên bản chính sách/đồng ý lưu trữ — đổi khi nội dung đồng ý đổi ⇒ app xin đồng ý lại. Máy chủ là nguồn duy nhất (app KHÔNG hardcode). */
export const PHIEN_BAN_DONG_Y_SUC_KHOE = "2026-11-22.1" as const;
export const HAN_LUU_MAC_DINH_THANG = 12;
export const HAN_LUU_TOI_THIEU_THANG = 1;
export const HAN_LUU_TOI_DA_THANG = 60;

const banSchema = z.object({ ngay: z.string(), cao: z.number().finite(), nang: z.number().finite(), eo: z.number().finite().nullable() }).strict();
const nguoiSchema = z
  .object({
    idCucBo: z.string().uuid(),
    tenGoi: z.string().trim().max(40).nullable().optional(),
    /** nhãn tự do phụ huynh gõ («Ba», «Con trai»…) */
    vaiTro: z.string().trim().max(30).nullable().optional(),
    ns: z.string(),
    gt: z.enum(["nu", "nam"]),
    /** mức vận động — đầu vào `nangLuongUocTinh`; mất nó khi khôi phục sang máy khác ⇒ kết quả khác máy cũ */
    hoatDong: z.enum(["it", "vua", "nhieu"]),
    mt: z.boolean(),
    benhNen: z.boolean(),
    ban: z.array(banSchema).max(TOI_DA_BAN),
  })
  .strict();

export const luuSucKhoeSchema = z
  .object({
    /** Khoá lạc quan (tuỳ chọn): `capNhatLuc` app đã thấy lần cuối. Có giá trị mà lệch bản đang lưu ⇒ 409 `SUC_KHOE_DA_THAY_DOI`; `null` = «tôi tin chưa có bản nào» (có bản ⇒ 409); vắng ⇒ ghi đè (last-write-wins). */
    truocCapNhatLuc: z.string().datetime().nullable().optional(),
    dongY: z.object({ phienBan: z.string().trim().min(1).max(32), luc: z.string().datetime() }).strict(),
    nguoi: z.array(nguoiSchema).max(TOI_DA_NGUOI_CONG),
  })
  .strict();
export type LuuSucKhoeBody = z.infer<typeof luuSucKhoeSchema>;

const THONG_BAO_BAN: Record<LoiBan, string> = {
  THIEU_NGAY: "Ngày đo không hợp lệ",
  NGAY_TUONG_LAI: "Ngày đo không được ở tương lai",
  CAO_SAI: "Chiều cao ngoài khoảng hợp lý (40–230 cm)",
  NANG_SAI: "Cân nặng ngoài khoảng hợp lý (2–250 kg)",
  EO_SAI: "Vòng eo ngoài khoảng hợp lý (30–200 cm)",
};

export type KetQuaKiemNoiDung = { ok: true } | { ok: false; field: string; thongBao: string };

/** Kiểm nội dung SAU khi qua `luuSucKhoeSchema`: trùng idCucBo, ngày sinh, từng bản số đo. `homNay` = yyyy-mm-dd theo giờ VN (tham số — không đọc đồng hồ). */
export function kiemNoiDungSucKhoe(body: LuuSucKhoeBody, homNay: string): KetQuaKiemNoiDung {
  const gap = new Set<string>();
  for (const [i, n] of body.nguoi.entries()) {
    const id = n.idCucBo.toLowerCase();
    if (gap.has(id)) return { ok: false, field: `nguoi.${i}.idCucBo`, thongBao: "Mã người nhà bị trùng" };
    gap.add(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.ns) || !laNgayHopLe(n.ns) || n.ns > homNay || n.ns < "1900-01-01") return { ok: false, field: `nguoi.${i}.ns`, thongBao: "Ngày sinh không hợp lệ" };
    for (const [j, b] of n.ban.entries()) {
      const loi = kiemBan(b, homNay);
      if (loi) return { ok: false, field: `nguoi.${i}.ban.${j}`, thongBao: THONG_BAO_BAN[loi] };
    }
  }
  return { ok: true };
}

/** Số tháng lưu: từ env (đọc ở lớp gọi, truyền vào đây); không hợp lệ/ngoài [1, 60] ⇒ mặc định 12 (không bao giờ «lưu vô hạn»). */
export function hanLuuThang(raw: string | undefined | null): number {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n >= HAN_LUU_TOI_THIEU_THANG && n <= HAN_LUU_TOI_DA_THANG ? n : HAN_LUU_MAC_DINH_THANG;
}

export type ThongTinLuuTru = { phienBanDongY: string; thoiHanThang: number };
/** Chính sách lưu trữ app cần BIẾT (không hardcode ở app): phiên bản đồng ý + số tháng lưu. `env` truyền vào (lõi không đọc process.env). */
export const thongTinLuuTru = (env: Record<string, string | undefined>): ThongTinLuuTru => ({ phienBanDongY: PHIEN_BAN_DONG_Y_SUC_KHOE, thoiHanThang: hanLuuThang(env["HEALTH_RETENTION_MONTHS"]) });

/** Hết hạn = hết NGÀY lịch VN của ngày (bây giờ + n tháng), kẹp cuối tháng — cùng quy ước thời hạn của hệ thống. */
export const tinhHetHanSucKhoe = (now: Date, thang: number): Date => congThangLich(now, thang);

/** Chuẩn hoá trước khi mã hoá: tên gọi trống ⇒ null, mọi khoá có mặt, bản rõ KHÔNG chứa trường nào ngoài lược đồ. */
export function chuanHoaChoLuu(body: LuuSucKhoeBody): { v: 1; dongY: LuuSucKhoeBody["dongY"]; nguoi: Array<Required<Omit<LuuSucKhoeBody["nguoi"][number], "tenGoi" | "vaiTro">> & { tenGoi: string | null; vaiTro: string | null }> } {
  return {
    v: 1,
    dongY: { phienBan: body.dongY.phienBan, luc: body.dongY.luc },
    nguoi: body.nguoi.map((n) => ({ idCucBo: n.idCucBo, tenGoi: n.tenGoi && n.tenGoi.trim() ? n.tenGoi.trim() : null, vaiTro: n.vaiTro && n.vaiTro.trim() ? n.vaiTro.trim() : null, ns: n.ns, gt: n.gt, hoatDong: n.hoatDong, mt: n.mt, benhNen: n.benhNen, ban: n.ban.map((b) => ({ ngay: b.ngay, cao: b.cao, nang: b.nang, eo: b.eo })) })),
  };
}
