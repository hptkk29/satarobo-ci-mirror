/**
 * lib/nguon/nguon-chup.ts — ẢNH CHỤP THUỘC TÍNH NGUỒN lúc ghi nhận (`LeadAttribution.signals.nguon`). THUẦN.
 *
 * ── Vì sao có (reviewer res4-1 · res3-3, 09/10/2026) ─────────────────────────────────────────────────────────
 * Engine hoa hồng từng đọc NGƯỜI PHỤ TRÁCH NGUỒN (`ownerEmployeeId`) và CỬA SỔ GHI CÔNG (`attributionWindowDays`) SỐNG từ dòng nguồn lúc quét
 * khoản thu. Người có `sources:manage` đổi hai cột ấy giữa đợt 1 và đợt 2 của một đơn trả góp ⇒ đợt 1 về A, đợt 2 về B; co cửa sổ ⇒ đợt 2–3 thành
 * `NGOAI_CUA_SO`. Nên hai giá trị này được CHỤP vào attribution ngay lúc ghi nhận (và lúc đổi nguồn có kiểm soát), engine đọc bản chụp.
 * `commissionEnabled` thì KHÔNG chụp: nó là công tắc "nguồn có tham gia chính sách theo nguồn không", đọc sống để tắt khẩn cấp được.
 *
 * ── BA trạng thái (không được gộp) ───────────────────────────────────────────────────────────────────────
 *  · `CHUA_CO`  khoá `nguon` VẮNG: hàng di trú / hàng ghi trước khi có bản chụp ⇒ engine RƠI VỀ dòng nguồn SỐNG (hành vi cũ).
 *  · `HOP_LE`   có khoá và đúng hình dạng ⇒ DÙNG bản chụp. `chuNhanVienId = null` là "KHÔNG có người phụ trách" CÓ THẨM QUYỀN (không rơi về nguồn sống:
 *               nguồn lúc ghi chưa có chủ thì chủ khai SAU không được hưởng ngược lên các lead cũ).
 *  · `HONG`     có khoá nhưng sai hình dạng ⇒ FAIL-CLOSED: không người phụ trách (hold), KHÔNG rơi về nguồn sống — rơi về sống là mở lại đúng lỗ này.
 *
 * `cuaSoNgay` là con số HIỆU LỰC lúc ghi (cửa sổ riêng của nguồn, hoặc setting chung lúc đó) chứ không phải cột có thể NULL — nếu không, đổi setting
 * chung sau này vẫn dịch cửa sổ của mọi attribution cũ.
 *
 * Mọi đọc/ghi `signals.nguon` đi qua tệp này (một Zod, không `as`).
 */
import { z } from "zod";

export const CUA_SO_NGAY_NGUON_TOI_DA = 3650;

export const nguonChupSchema = z
  .object({
    cuaSoNgay: z.number().int().min(1).max(CUA_SO_NGAY_NGUON_TOI_DA),
    chuNhanVienId: z.string().min(1).nullable(),
  })
  .strict();

export type NguonChup = z.infer<typeof nguonChupSchema>;

export type KetQuaDocNguonChup = { trangThai: "CHUA_CO" } | { trangThai: "HONG" } | { trangThai: "HOP_LE"; nguon: NguonChup };

const laDoiTuong = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Đọc `signals.nguon` của một attribution. `signals` là JSON tuỳ ý trong DB ⇒ không tin kiểu. */
export function docNguonChup(signals: unknown): KetQuaDocNguonChup {
  if (!laDoiTuong(signals) || !Object.prototype.hasOwnProperty.call(signals, "nguon")) return { trangThai: "CHUA_CO" };
  const r = nguonChupSchema.safeParse(signals.nguon);
  return r.success ? { trangThai: "HOP_LE", nguon: r.data } : { trangThai: "HONG" };
}

/**
 * Giá trị engine dùng cho MỘT attribution: bản chụp nếu có; hàng chưa có bản chụp thì rơi về dòng nguồn SỐNG; bản chụp hỏng thì fail-closed.
 * `cuaSoRiengNgay` null ⇒ engine dùng setting chung (`cuaSoHieuLuc`).
 */
export function nguonHieuLucChoEngine(
  signals: unknown,
  song: { cuaSoRiengNgay: number | null; chuNhanVienId: string | null },
): { cuaSoRiengNgay: number | null; chuNhanVienId: string | null; nguonGoc: "BAN_CHUP" | "NGUON_SONG" | "BAN_CHUP_HONG" } {
  const d = docNguonChup(signals);
  if (d.trangThai === "HOP_LE") return { cuaSoRiengNgay: d.nguon.cuaSoNgay, chuNhanVienId: d.nguon.chuNhanVienId, nguonGoc: "BAN_CHUP" };
  if (d.trangThai === "HONG") return { cuaSoRiengNgay: null, chuNhanVienId: null, nguonGoc: "BAN_CHUP_HONG" };
  return { cuaSoRiengNgay: song.cuaSoRiengNgay, chuNhanVienId: song.chuNhanVienId, nguonGoc: "NGUON_SONG" };
}

/** Dựng bản chụp từ thuộc tính nguồn lúc này. `cuaSoMacDinhNgay` = setting chung lúc ghi. Chủ nguồn được chụp NGUYÊN — kể cả khi chính họ nhập lead (bình thường). */
export function chupNguon(p: {
  cuaSoRiengNgay: number | null;
  cuaSoMacDinhNgay: number;
  chuNhanVienId: string | null;
}): NguonChup {
  return { cuaSoNgay: p.cuaSoRiengNgay ?? p.cuaSoMacDinhNgay, chuNhanVienId: p.chuNhanVienId };
}
