// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/doi-chieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * VÙNG LỆCH CON ↔ CHA MẸ — hàm THUẦN, thuộc TẦNG LÕI (ADR-004).
 *
 * 🔴 Đây là tính năng chủ lực của cả sản phẩm. Ba bộ đề đầu ngoài kia có hàng chục trang
 * làm miễn phí; bộ đối chiếu thì gần như không ai làm, và nó có cơ sở học thuật thật
 * (informant discrepancies — De Los Reyes).
 *
 * BỐN ĐIỀU KIỆN GHÉP CẶP (§8.2), thiếu một là KHÔNG ghép:
 *  1. Có bài của con: bộ TH hoặc THCS, HỢP LỆ.
 *  2. Có bài của bố mẹ về con: bộ QS, HỢP LỆ.
 *  3. Cùng một biệt danh.
 *  4. Hai bài cách nhau ≤ 60 ngày — và CÙNG phiên bản bộ đề.
 *
 * Chưa đủ ⇒ trả về lý do cụ thể để giao diện mời làm nốt bài kia. KHÔNG bao giờ trả về
 * "không có gì" để rồi màn hình rỗng.
 */

import {
  NHAN_MUC_LECH,
  VAN_BAN_LECH,
  type HuongLech,
  type MaMucLech,
} from "@/lib/disc/engine-goc/config/disc-doi-chieu";
import { NGUONG_VUNG_LECH } from "@/lib/disc/engine-goc/config/disc-nguong";

import { MA_TRUC, type KetQua, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { soNgayGiua } from "@/lib/disc/engine-goc/modules/core/tien-ich/ngay";

/** Bộ nào là "con tự làm", bộ nào là "bố mẹ nhìn con". */
export const BO_DE_CON: readonly MaBoDe[] = ["TH", "THCS"];
export const BO_DE_BO_ME = "QS" as const;

export type BaiDeGhep = {
  readonly id: string;
  readonly boDe: MaBoDe;
  readonly maTre: string;
  readonly ketThuc: string;
  readonly ketQua: KetQua;
  readonly phienBanBoDe: string;
  /** Tuổi đứa trẻ. Chỉ bản ghi bộ QS mới có — dùng để mời ĐÚNG bộ con tự làm. */
  readonly tuoi?: number;
};

export type LechMotTruc = {
  readonly truc: MaTruc;
  readonly diemCon: number;
  readonly diemBoMe: number;
  /** Có dấu: dương = con tự thấy CAO hơn cha mẹ thấy. */
  readonly lech: number;
  readonly mucLech: MaMucLech;
  readonly nhan: string;
  readonly mau: string;
  readonly huong: HuongLech;
};

export type LyDoChuaGhep =
  | { readonly ma: "THIEU_BAI_CON"; readonly tuoi?: number }
  | { readonly ma: "THIEU_BAI_BO_ME" }
  | { readonly ma: "KHAC_PHIEN_BAN" }
  | { readonly ma: "QUA_HAN"; readonly soNgay: number };

export type KetQuaDoiChieu =
  | { readonly ghepDuoc: false; readonly lyDo: LyDoChuaGhep }
  | {
      readonly ghepDuoc: true;
      readonly maTre: string;
      readonly baiCon: BaiDeGhep;
      readonly baiBoMe: BaiDeGhep;
      /** Bốn trục, giữ thứ tự cố định D-I-S-C. */
      readonly bang: readonly LechMotTruc[];
      /** 🔴 Tối đa HAI trục lệch lớn nhất — nói ít mà trúng. */
      readonly dienGiai: readonly { readonly truc: MaTruc; readonly than: string }[];
    };

export function mucLechTu(lech: number): MaMucLech {
  const tuyetDoi = Math.abs(lech);
  if (tuyetDoi <= NGUONG_VUNG_LECH.trungKhopToiDa) return "trungKhop";
  if (tuyetDoi <= NGUONG_VUNG_LECH.hoiKhacToiDa) return "hoiKhac";
  return "khacRo";
}

function tinhMotTruc(truc: MaTruc, diemCon: number, diemBoMe: number): LechMotTruc {
  const lech = Math.round((diemCon - diemBoMe) * 10) / 10;
  const mucLech = mucLechTu(lech);
  return {
    truc,
    diemCon,
    diemBoMe,
    lech,
    mucLech,
    nhan: NHAN_MUC_LECH[mucLech].ten,
    mau: NHAN_MUC_LECH[mucLech].mau,
    huong: lech >= 0 ? "con-cao-hon" : "con-thap-hon",
  };
}

/** Chọn cặp bài mới nhất của mỗi phía cho một biệt danh. */
export function chonCapMoiNhat(
  ds: readonly BaiDeGhep[],
  maTre: string,
): { con: BaiDeGhep | null; boMe: BaiDeGhep | null } {
  const cua = ds
    .filter((b) => b.maTre === maTre && b.ketQua.hopLe)
    .sort((a, b) => b.ketThuc.localeCompare(a.ketThuc));
  return {
    con: cua.find((b) => BO_DE_CON.includes(b.boDe)) ?? null,
    boMe: cua.find((b) => b.boDe === BO_DE_BO_ME) ?? null,
  };
}

export function doiChieu(ds: readonly BaiDeGhep[], maTre: string): KetQuaDoiChieu {
  const { con, boMe } = chonCapMoiNhat(ds, maTre);
  // Kèm tuổi lấy từ bài bộ QS (nếu có) để lời mời chọn đúng bộ con tự làm — bộ QS trải
  // 8–15 tuổi nên mã bộ đề một mình không đủ để suy ra.
  if (!con) {
    return { ghepDuoc: false, lyDo: { ma: "THIEU_BAI_CON", ...(boMe?.tuoi !== undefined ? { tuoi: boMe.tuoi } : {}) } };
  }
  if (!boMe) return { ghepDuoc: false, lyDo: { ma: "THIEU_BAI_BO_ME" } };

  // Sửa nội dung câu là đổi ý nghĩa của điểm số — hai phiên bản khác nhau thì con số
  // vẫn trừ được, nhưng phép trừ đó vô nghĩa.
  if (con.phienBanBoDe !== boMe.phienBanBoDe) {
    return { ghepDuoc: false, lyDo: { ma: "KHAC_PHIEN_BAN" } };
  }

  // `null` = có chuỗi ngày hỏng. Không đoán bừa thành 0 ngày.
  const soNgay = soNgayGiua(con.ketThuc, boMe.ketThuc);
  if (soNgay === null || soNgay > NGUONG_VUNG_LECH.soNgayToiDa) {
    return {
      ghepDuoc: false,
      lyDo: { ma: "QUA_HAN", soNgay: soNgay ?? NGUONG_VUNG_LECH.soNgayToiDa + 1 },
    };
  }

  if (!con.ketQua.hopLe || !boMe.ketQua.hopLe) {
    return { ghepDuoc: false, lyDo: { ma: "THIEU_BAI_CON", ...(boMe.tuoi !== undefined ? { tuoi: boMe.tuoi } : {}) } };
  }

  const bang = MA_TRUC.map((t) =>
    tinhMotTruc(t, con.ketQua.hopLe ? con.ketQua.diem[t] : 0, boMe.ketQua.hopLe ? boMe.ketQua.diem[t] : 0),
  );

  // 🔴 Tối đa HAI trục lệch lớn nhất, và chỉ những trục THẬT SỰ lệch (không "trùng khớp").
  const dienGiai = [...bang]
    .filter((x) => x.mucLech !== "trungKhop")
    .sort((a, b) => Math.abs(b.lech) - Math.abs(a.lech))
    .slice(0, NGUONG_VUNG_LECH.soTrucDienGiaiToiDa)
    .map((x) => ({ truc: x.truc, than: VAN_BAN_LECH[x.truc][x.huong] }));

  return { ghepDuoc: true, maTre, baiCon: con, baiBoMe: boMe, bang, dienGiai };
}

/** Danh sách biệt danh có ít nhất một bài — để giao diện cho chọn xem cặp nào. */
export function bietDanhCoBai(ds: readonly BaiDeGhep[]): string[] {
  return [...new Set(ds.filter((b) => b.ketQua.hopLe).map((b) => b.maTre))].sort();
}
