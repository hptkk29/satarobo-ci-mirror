/**
 * ĐỊNH TUYẾN BỘ ĐỀ CHO MỘT THÀNH VIÊN (doc 18, mục 2.4) — MỘT chỗ duy nhất quyết «người này làm bộ nào».
 *
 *   Người được đánh giá      Tự làm                         Theo góc nhìn chủ sổ
 *   Người lớn                PH                             KHÔNG có bộ — chặn
 *   Con < 8 tuổi / MN–lớp 2  không cho tự làm (ADR-002)    MN
 *   Con lớp 3–5, ≥ 8 tuổi    TH                             QS
 *   Con lớp 6–9              THCS                           QS
 *   Con lớp 10–12 / trên 12  PH (câu người lớn)             QS chỉ phủ 8–15 tuổi ⇒ trên 15 tuổi CHẶN
 *
 * Lựa chọn «theo góc nhìn» LUÔN mở (kể cả với người đã tự làm) — hàm này chỉ trả lời «bộ nào / vì sao không».
 * Tuổi suy từ NĂM SINH (không bao giờ suy từ lớp: lớp 7 có cả bé 12 lẫn 13). Thiếu năm sinh ⇒ chỉ xét theo lớp,
 * và nghiêng về phía KHÔNG để trẻ nhỏ tự làm.
 *
 * ⚠️ KHÔNG import engine-goc (client dùng để xem trước «hệ thống tự suy ra»): các ranh giới lớp chép lại ở đây và
 * `dinh-tuyen-bai.test.ts` [SG-DT-12] so khớp TỪNG ô (vai × lớp) với `boDeChoThanhVien` / `boDeQuanSatTheoLop` của engine gốc.
 */
import type { CachLam, MaBoDe } from "./kieu";
import { LOP_MAM_NON, LOP_TREN_12, coHoiLop, soLopCua, type VaiGiaDinh } from "./vai";

/** Bộ QS (bố mẹ quan sát con) chỉ phủ trẻ 8–15 tuổi. */
export const TUOI_TOI_DA_BO_QUAN_SAT = 15;
/** Trẻ dưới tuổi này không tự đánh giá (ADR-002). Khớp `TUOI_TU_DANH_GIA_TOI_THIEU` của engine. */
export const TUOI_TU_DANH_GIA_TOI_THIEU = 8;
const LOP_CUOI_BAC_NHO = 2;
const LOP_CUOI_TIEU_HOC = 5;
const LOP_DAU_CAP_BA = 10;

export type LyDoChanBai =
  | "CHUA_CO_LOP"
  | "TRE_NHO_KHONG_TU_LAM"
  | "NGUOI_LON_CHUA_HO_TRO_GOC_NHIN"
  | "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT";

export const CAU_LY_DO_CHAN: Readonly<Record<LyDoChanBai, string>> = {
  CHUA_CO_LOP: "Chưa có lớp nên chưa chọn được bộ câu hỏi. Thêm lớp ở mục Thành viên.",
  TRE_NHO_KHONG_TU_LAM:
    "Bé còn nhỏ nên chưa tự làm bài — người lớn trả lời theo cách quan sát bé (chọn «Theo góc nhìn của bạn»).",
  NGUOI_LON_CHUA_HO_TRO_GOC_NHIN: "Chưa hỗ trợ đánh giá người lớn qua người khác. Người lớn tự làm bài của mình.",
  QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT:
    "Bộ quan sát của bố mẹ chỉ phủ trẻ 8–15 tuổi. Bé từ 16 tuổi nên tự làm bài.",
};

export type KetQuaBo =
  | { readonly duoc: true; readonly boDe: MaBoDe }
  | { readonly duoc: false; readonly lyDo: LyDoChanBai };

export type DauVaoBo = {
  readonly vaiTro: VaiGiaDinh;
  readonly lop: string | null;
  /** Tuổi (năm hiện tại − năm sinh); null nếu chưa khai năm sinh. */
  readonly tuoi: number | null;
};

/** Tuổi theo năm sinh và năm hiện tại (giờ VN). Phi lý (âm, > 120) ⇒ null. */
export function tuoiTuNamSinh(namSinh: number | null, namNay: number): number | null {
  if (namSinh === null || !Number.isInteger(namSinh)) return null;
  const t = namNay - namSinh;
  return t >= 0 && t <= 120 ? t : null;
}

const lopHopLe = (lop: string | null): lop is string => lop === LOP_MAM_NON || lop === LOP_TREN_12 || soLopCua(lop) !== undefined;

export function boDeChoBai(tv: DauVaoBo, cach: CachLam): KetQuaBo {
  const nguoiLon = !coHoiLop(tv.vaiTro);

  if (cach === "GOC_NHIN") {
    if (nguoiLon) return { duoc: false, lyDo: "NGUOI_LON_CHUA_HO_TRO_GOC_NHIN" };
    if (!lopHopLe(tv.lop)) return { duoc: false, lyDo: "CHUA_CO_LOP" };
    if (tv.tuoi !== null && tv.tuoi < TUOI_TU_DANH_GIA_TOI_THIEU) return { duoc: true, boDe: "MN" };
    if (tv.lop === LOP_MAM_NON) return { duoc: true, boDe: "MN" };
    // «Trên lớp 12» chắc chắn quá 15 tuổi (không có bộ quan sát cho lớp này).
    if (tv.lop === LOP_TREN_12) return { duoc: false, lyDo: "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT" };
    const so = soLopCua(tv.lop)!;
    if (so <= LOP_CUOI_BAC_NHO) return { duoc: true, boDe: "MN" };
    const quaTuoi = tv.tuoi !== null ? tv.tuoi > TUOI_TOI_DA_BO_QUAN_SAT : so >= LOP_DAU_CAP_BA;
    return quaTuoi ? { duoc: false, lyDo: "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT" } : { duoc: true, boDe: "QS" };
  }

  // TU_LAM
  if (nguoiLon) return { duoc: true, boDe: "PH" };
  if (!lopHopLe(tv.lop)) return { duoc: false, lyDo: "CHUA_CO_LOP" };
  if (tv.lop === LOP_TREN_12) return { duoc: true, boDe: "PH" };
  // Mầm non · lớp 1–2 ⇒ bộ do người lớn trả lời hộ ⇒ KHÔNG cho bé tự làm (ADR-002).
  if (tv.lop === LOP_MAM_NON || soLopCua(tv.lop)! <= LOP_CUOI_BAC_NHO) return { duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" };
  // Bé < 8 tuổi cũng vậy, kể cả đang học lớp cao hơn.
  if (tv.tuoi !== null && tv.tuoi < TUOI_TU_DANH_GIA_TOI_THIEU) return { duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" };
  const so = soLopCua(tv.lop)!;
  if (so >= LOP_DAU_CAP_BA) return { duoc: true, boDe: "PH" };
  return { duoc: true, boDe: so <= LOP_CUOI_TIEU_HOC ? "TH" : "THCS" };
}

export type CachLamKhaDung = { readonly tuLam: KetQuaBo; readonly gocNhin: KetQuaBo };

export function cachLamKhaDung(tv: DauVaoBo): CachLamKhaDung {
  return { tuLam: boDeChoBai(tv, "TU_LAM"), gocNhin: boDeChoBai(tv, "GOC_NHIN") };
}

/** Bé làm bài ở «chế độ trẻ em» (bé cầm máy): tự làm bộ TH/THCS. */
export function laCheDoTreEm(boDe: MaBoDe, cach: CachLam): boolean {
  return cach === "TU_LAM" && (boDe === "TH" || boDe === "THCS");
}
