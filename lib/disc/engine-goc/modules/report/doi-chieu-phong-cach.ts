// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/doi-chieu-phong-cach.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * LỆCH PHONG CÁCH BỐ MẸ ↔ CON — hàm THUẦN, thuộc TẦNG LÕI (ADR-004).
 *
 * 🔴 KHÁC HẲN `doi-chieu.ts`, đừng nhầm hai cái:
 *   - `doiChieu()`      so *con tự thấy* với *bố mẹ nhìn con*. Một đứa trẻ, hai góc nhìn.
 *   - `doiChieuPhongCach()` so *phong cách của bố mẹ* với *phong cách của con*. HAI NGƯỜI
 *     khác nhau, và chỗ vênh giữa họ chính là chỗ va nhau hằng ngày trong nhà.
 *
 * Vì sao đáng làm: đây là thứ chạm cảm xúc nhất mà DISC làm được cho phụ huynh — *"bố mẹ
 * nhóm D, con nhóm S: bố mẹ thấy con chậm chạp, con thấy mình bị hối"*. Hạ tầng đã dựng từ
 * GĐ5 (bộ PH, kho bài, ngưỡng lệch) nhưng chưa nối vào đâu cả.
 *
 * 🔴 GHÉP CẶP KHÔNG DÙNG BIỆT DANH. Bài bộ PH mang biệt danh của CHÍNH PHỤ HUYNH ("Mẹ
 * Bống"), bài của con mang biệt danh của con ("Tí Nị") — không có trường nào nối hai bên.
 * Nên cách duy nhất trung thực là: lấy bài PH mới nhất trên máy, và ghép với ĐÚNG bài con
 * mà người dùng đang mở. Không đoán quan hệ gia đình từ dữ liệu.
 */

import { NGUONG_VUNG_LECH } from "@/lib/disc/engine-goc/config/disc-nguong";
import {
  LECH_PHONG_CACH,
  type HuongLechPhongCach,
  type KhoiLechPhongCach,
} from "@/lib/disc/engine-goc/config/disc-loi-khuyen";
import { NHAN_MUC_LECH, type MaMucLech } from "@/lib/disc/engine-goc/config/disc-doi-chieu";

import { MA_TRUC, type KetQua, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/** Bộ đề mà người lớn tự đánh giá CHÍNH MÌNH. */
export const BO_DE_BO_ME_TU_DANH_GIA: MaBoDe = "PH";

export type BaiPhongCach = {
  readonly id: string;
  readonly boDe: MaBoDe;
  readonly maTre: string;
  readonly ketThuc: string;
  readonly ketQua: KetQua;
};

export type LechTrucPhongCach = {
  readonly truc: MaTruc;
  readonly diemBoMe: number;
  readonly diemCon: number;
  /** Có dấu: dương = bố mẹ cao hơn con. */
  readonly lech: number;
  readonly mucLech: MaMucLech;
  readonly nhan: string;
  readonly mau: string;
  readonly huong: HuongLechPhongCach;
};

export type KetQuaPhongCach =
  | { readonly ghepDuoc: false; readonly lyDo: "THIEU_BAI_BO_ME" | "BAI_CON_KHONG_HOP_LE" }
  | {
      readonly ghepDuoc: true;
      readonly baiBoMe: BaiPhongCach;
      /** Bốn trục, giữ thứ tự cố định D-I-S-C để đọc cùng nhịp với biểu đồ. */
      readonly bang: readonly LechTrucPhongCach[];
      /**
       * 🔴 Tối đa HAI trục lệch lớn nhất — nói ít mà trúng, cùng luật với vùng lệch.
       *
       * Từ GĐ10 chặng 2 mỗi trục trả về CẢ BỐN cách kể, không phải một đoạn. Tầng lõi cố ý
       * KHÔNG chọn hộ xem người đọc là ai — nó không biết ai đang cầm máy. Giao diện mới
       * biết, và nó đổ từng trường vào đúng dải `data-ban` của nó.
       */
      readonly dienGiai: readonly (KhoiLechPhongCach & { readonly truc: MaTruc })[];
    };

function mucLechTu(lech: number): MaMucLech {
  const tuyetDoi = Math.abs(lech);
  if (tuyetDoi <= NGUONG_VUNG_LECH.trungKhopToiDa) return "trungKhop";
  if (tuyetDoi <= NGUONG_VUNG_LECH.hoiKhacToiDa) return "hoiKhac";
  return "khacRo";
}

/**
 * Bài bộ PH mới nhất và HỢP LỆ trên máy này.
 *
 * Cố ý không lọc theo biệt danh: xem khối chú thích đầu file. Máy dùng chung nhiều gia đình
 * thì bài PH mới nhất vẫn là phỏng đoán tốt nhất mà dữ liệu cho phép — và giao diện phải
 * nói rõ đây là "hồ sơ của bạn", để người đọc tự biết nó có đúng của họ không.
 */
export function timBaiBoMeMoiNhat(ds: readonly BaiPhongCach[]): BaiPhongCach | null {
  return (
    ds
      .filter((b) => b.boDe === BO_DE_BO_ME_TU_DANH_GIA && b.ketQua.hopLe)
      .sort((a, b) => b.ketThuc.localeCompare(a.ketThuc))[0] ?? null
  );
}

/**
 * So phong cách bố mẹ với phong cách con.
 *
 * `hoSoCon` là kết quả của bài đang mở — có thể là con tự làm (TH/THCS) hoặc bố mẹ quan sát
 * (MN/QS); cả hai đều mô tả đứa trẻ nên đều dùng được.
 */
export function doiChieuPhongCach(
  ds: readonly BaiPhongCach[],
  hoSoCon: KetQua,
  boDeCon: MaBoDe,
): KetQuaPhongCach {
  if (!hoSoCon.hopLe) return { ghepDuoc: false, lyDo: "BAI_CON_KHONG_HOP_LE" };

  // Bài PH so với chính nó thì không nói lên điều gì.
  if (boDeCon === BO_DE_BO_ME_TU_DANH_GIA) {
    return { ghepDuoc: false, lyDo: "THIEU_BAI_BO_ME" };
  }

  const boMe = timBaiBoMeMoiNhat(ds);
  if (!boMe || !boMe.ketQua.hopLe) return { ghepDuoc: false, lyDo: "THIEU_BAI_BO_ME" };
  const diemBoMe = boMe.ketQua.diem;

  const bang: LechTrucPhongCach[] = MA_TRUC.map((t) => {
    const lech = Math.round((diemBoMe[t] - hoSoCon.diem[t]) * 10) / 10;
    const mucLech = mucLechTu(lech);
    return {
      truc: t,
      diemBoMe: diemBoMe[t],
      diemCon: hoSoCon.diem[t],
      lech,
      mucLech,
      nhan: NHAN_MUC_LECH[mucLech].ten,
      mau: NHAN_MUC_LECH[mucLech].mau,
      huong: lech >= 0 ? "bo-me-cao-hon" : "bo-me-thap-hon",
    };
  });

  const dienGiai = [...bang]
    .filter((x) => x.mucLech !== "trungKhop")
    .sort((a, b) => Math.abs(b.lech) - Math.abs(a.lech))
    .slice(0, NGUONG_VUNG_LECH.soTrucDienGiaiToiDa)
    .map((x) => ({ truc: x.truc, ...LECH_PHONG_CACH[x.truc][x.huong] }));

  return { ghepDuoc: true, baiBoMe: boMe, bang, dienGiai };
}
