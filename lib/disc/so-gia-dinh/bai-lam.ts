/**
 * PHÁT ĐỀ + NỘP BÀI cho một thành viên trong sổ — lớp mỏng trên `ngan-hang/de-ky.ts` (đã code & có test ở patch ngân hàng).
 *
 * Hai đường, chọn bằng cờ `DISC_NGAN_HANG_ENABLED` (doc 18, 9.2; mặc định TẮT):
 *   · TẮT ⇒ ĐỀ GỐC 104 câu (đúng thứ tự gốc, `phienBanBoDe = "1.1"`) — đường lùi một bước, không cần deploy.
 *   · BẬT ⇒ bốc từ ngân hàng 12.752 câu, KHÔNG TRÙNG với những câu người này đã thấy (`phienBanBoDe = "nh:nh1"`).
 * Cả hai đều đi qua vé mã hoá gắn NGƯỜI LÀM và có HẠN; cả hai đều chấm bằng `cham()` gốc ⇒ điểm cùng thước.
 *
 * Nơi gọi PHẢI: (1) kiểm quyền sở hữu thành viên; (2) lấy `boDeMongDoi` từ `boDeChoBai` (MỘT chỗ định tuyến) — không tin client;
 * (3) ghi bài + nối `maCau` vào lịch sử «đã thấy» trong CÙNG giao dịch.
 *
 * Thuần (không DB, không đồng hồ thật): khoá và `bayGio` truyền vào.
 */
import { PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import type { MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { type DeDaBoc, deChoKhach } from "@/lib/disc/ngan-hang/boc-de";
import { HAN_VE_PHUT, docVe, kyDe, nopBai, phatDe, type DePhatRa, type KetQuaNopBai, type LyDoVe } from "@/lib/disc/ngan-hang/de-ky";
import { PHIEN_BAN_KHUNG } from "@/lib/disc/ngan-hang/khung";
import { oKhungCua } from "@/lib/disc/ngan-hang/nap";

export { HAN_VE_PHUT };

/** Cờ bật ngân hàng 12.752 câu. Mặc định TẮT: dùng đề gốc. */
export function nganHangDangBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISC_NGAN_HANG_ENABLED === "true";
}

/** Đề gốc 104 câu của một bộ: mã câu = mã ô khung, đúng thứ tự hiển thị. */
export function deGoc(boDe: MaBoDe): DeDaBoc {
  return { boDe, phienBanKhung: PHIEN_BAN_KHUNG, maCau: oKhungCua(boDe) };
}

/** Đề này có phải ĐỀ GỐC (mọi câu là câu gốc theo đúng ô) không ⇒ phiên bản `1.1`. */
export function laDeGoc(boDe: MaBoDe, maCau: readonly string[]): boolean {
  const o = oKhungCua(boDe);
  return maCau.length === o.length && maCau.every((m, i) => m === o[i]);
}

function dePhatRaTuDe(de: DeDaBoc, ve: string): DePhatRa {
  const goc = NGAN_HANG[de.boDe];
  return {
    ve,
    boDe: de.boDe,
    cauDan: goc.cauDan,
    cauMoiMan: goc.cauMoiMan,
    thang: goc.thang.map((m) => ({ gia: m.giaTri, nhan: m.nhan, ...(m.mat ? { mat: m.mat } : {}) })),
    cau: deChoKhach(de),
  };
}

export function phatDeChoThanhVien(a: {
  readonly boDe: MaBoDe;
  readonly thanhVienId: string;
  /** Mã câu đã thấy, CŨ TRƯỚC — MỚI SAU. */
  readonly daThay: readonly string[];
  readonly hat: string;
  readonly khoa: string;
  readonly bayGio: Date;
  readonly dungNganHang: boolean;
}): DePhatRa {
  if (a.dungNganHang) {
    return phatDe({ boDe: a.boDe, nguoiLam: a.thanhVienId, daThay: a.daThay, hat: a.hat, khoa: a.khoa, bayGio: a.bayGio });
  }
  const de = deGoc(a.boDe);
  const hetHan = new Date(a.bayGio.getTime() + HAN_VE_PHUT * 60_000);
  return dePhatRaTuDe(de, kyDe(de, a.khoa, a.thanhVienId, hetHan));
}

/** Dựng lại đề từ một vé còn hạn (làm tiếp bản nháp). Vé hỏng/hết hạn/sai người ⇒ lý do. */
export function dePhatRaTuVe(a: {
  readonly ve: string;
  readonly thanhVienId: string;
  readonly khoa: string;
  readonly bayGio: Date;
}): { readonly ok: true; readonly de: DePhatRa; readonly maCau: readonly string[] } | { readonly ok: false; readonly lyDo: LyDoVe } {
  const d = docVe(a.ve, a.khoa, a.thanhVienId, a.bayGio);
  if (!d.ok) return d;
  return { ok: true, de: dePhatRaTuDe(d.de, a.ve), maCau: d.de.maCau };
}

export type LyDoNopSo = Extract<KetQuaNopBai, { ok: false }>["lyDo"] | "SAI_BO_DE";

export type KetQuaNopSo =
  | (Extract<KetQuaNopBai, { ok: true }> & { readonly laDeGoc: boolean })
  | { readonly ok: false; readonly lyDo: LyDoNopSo };

export function nopBaiChoThanhVien(a: {
  readonly ve: string;
  readonly theoViTri: unknown;
  readonly thanhVienId: string;
  /** Bộ đề do SERVER định tuyến (`boDeChoBai`) — vé phát cho bộ khác ⇒ từ chối. */
  readonly boDeMongDoi: MaBoDe;
  readonly khoa: string;
  readonly bayGio: Date;
}): KetQuaNopSo {
  const r = nopBai({ ve: a.ve, theoViTri: a.theoViTri, nguoiLam: a.thanhVienId, khoa: a.khoa, bayGio: a.bayGio });
  if (!r.ok) return r;
  if (r.boDe !== a.boDeMongDoi) return { ok: false, lyDo: "SAI_BO_DE" };
  const goc = laDeGoc(r.boDe, r.maCau);
  return { ...r, phienBanBoDe: goc ? PHIEN_BAN_BO_DE : r.phienBanBoDe, laDeGoc: goc };
}

export const CAU_LOI_NOP: Readonly<Record<LyDoNopSo, string>> = {
  VE_HONG: "Phiên làm bài không hợp lệ. Hãy mở lại bài.",
  HET_HAN: "Phiên làm bài đã hết hạn (24 giờ). Hãy mở lại bài để làm lại.",
  SAI_NGUOI_LAM: "Phiên làm bài này không phải của thành viên đã chọn.",
  SAI_KHUNG: "Bộ câu hỏi vừa được cập nhật. Hãy mở lại bài.",
  THIEU_CAU_TRA_LOI: "Còn câu chưa trả lời. Hãy trả lời đủ các câu.",
  GIA_TRI_KHONG_HOP_LE: "Có câu trả lời không hợp lệ. Hãy mở lại bài.",
  TRA_LOI_PHANG: "Các câu trả lời gần như giống hệt nhau nên chưa tính được kết quả. Hãy đọc kỹ từng câu và làm lại.",
  SAI_BO_DE: "Bộ câu hỏi không khớp với thành viên này. Hãy mở lại bài.",
};
