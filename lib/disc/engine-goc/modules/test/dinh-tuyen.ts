// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/test/dinh-tuyen.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * LUẬT ĐỊNH TUYẾN — chọn bộ đề từ đối tượng người dùng (DISC_BA.md §4.2).
 *
 * 🔴 Đây là chỗ mà một sản phẩm DISC cho trẻ em hoặc đứng vững, hoặc bịa số.
 *
 * Bằng chứng: phương sai do "gật bừa" ở trẻ em lớn gấp đôi người lớn; công cụ chuẩn cho
 * lứa 3–7 tuổi trên thế giới (CBQ của Rothbart) là bảng do PHỤ HUYNH điền, không tồn tại
 * bản trẻ mẫu giáo tự làm. 8 tuổi là sàn thực dụng cho tự đánh giá. (ADR-002)
 *
 * Hàm thuần: không React, không DOM. Đổi luật ở đây thì `tests/dinh-tuyen.test.ts` đỏ —
 * cố ý.
 */

import { coHoiLop, type VaiGiaDinh } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import {
  LOP_CUOI_TIEU_HOC,
  LOP_DAU_CAP_BA,
  LOP_MAM_NON,
  LOP_TREN_12,
  TUOI_VAO_THCS,
  soLopCua,
} from "@/lib/disc/engine-goc/config/disc-nguong";

import type { MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

export type MucTieuPhuHuynh = "toi" | "con";

export type DauVaoDinhTuyen = {
  /**
   * `cap-ba-tro-len` gộp CẢ lớp 10–12 LẪN "đã qua lớp 12" (11.5). Gộp được vì cả hai ra
   * cùng một bộ đề và cùng một tầng nội dung; tách ra chỉ để trưng bày một khác biệt
   * không dẫn tới hành vi nào khác.
   */
  readonly doiTuong: "mam-non" | "tieu-hoc" | "thcs" | "cap-ba-tro-len" | "phu-huynh";
  /** Chỉ dùng ĐỊNH TUYẾN. Không đưa vào kết quả, không lưu kèm báo cáo. */
  readonly lop?: number;
  readonly mucTieu?: MucTieuPhuHuynh;
  readonly tuoiCon?: number;
};

/** Lý do người làm bị chuyển sang bản quan sát — luôn phải HIỆN RA, không chuyển im lặng. */
export type MaGiaiThich = "LOP_1_2" | "CON_DUOI_8";

export type KetQuaDinhTuyen =
  | { readonly xong: false; readonly hoiThem: "lop" | "muc-tieu" | "tuoi-con" }
  | { readonly xong: true; readonly boDe: MaBoDe; readonly giaiThich?: MaGiaiThich };

/** Tuổi tối thiểu để một đứa trẻ TỰ đánh giá được. Dưới mức này ⇒ người lớn quan sát. */
export const TUOI_TU_DANH_GIA_TOI_THIEU = 8;

/** Lớp cao nhất vẫn phải dùng bản quan sát (lớp 1 và lớp 2). */
export const LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT = 2;

export function dinhTuyen(dv: DauVaoDinhTuyen): KetQuaDinhTuyen {
  switch (dv.doiTuong) {
    case "mam-non":
      return { xong: true, boDe: "MN" };

    case "thcs":
      return { xong: true, boDe: "THCS" };

    // 🔴 Cấp ba trở lên dùng bộ PHỤ HUYNH — đó là bản TỰ ĐÁNH GIÁ cho người lớn, không
    // phải "bản của bố mẹ". Tên bộ đề đọc lên dễ gây hiểu nhầm; chỗ chữ hiện ra cho người
    // dùng thì nói "bản tự đánh giá", xem `CHU_CHON`.
    case "cap-ba-tro-len":
      return { xong: true, boDe: "PH" };

    case "tieu-hoc": {
      if (dv.lop === undefined) return { xong: false, hoiThem: "lop" };
      // 🔴 Lớp 1–2 KHÔNG BAO GIỜ được ra bộ TH. Đọc được chữ nhưng vẫn gật bừa nặng.
      if (dv.lop <= LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT) {
        return { xong: true, boDe: "MN", giaiThich: "LOP_1_2" };
      }
      return { xong: true, boDe: "TH" };
    }

    case "phu-huynh": {
      if (dv.mucTieu === undefined) return { xong: false, hoiThem: "muc-tieu" };
      if (dv.mucTieu === "toi") return { xong: true, boDe: "PH" };
      if (dv.tuoiCon === undefined) return { xong: false, hoiThem: "tuoi-con" };
      // Bộ QS chỉ mở khi con ≥ 8 tuổi — nó cần con tự làm bài kia để đối chiếu.
      if (dv.tuoiCon < TUOI_TU_DANH_GIA_TOI_THIEU) {
        return { xong: true, boDe: "MN", giaiThich: "CON_DUOI_8" };
      }
      return { xong: true, boDe: "QS" };
    }
  }
}

/* ── Bộ đề cho MỘT NGƯỜI TRONG SỔ GIA ĐÌNH (V1.3) ────────────────────────── */

/** Những bộ đề mà NGƯỜI LỚN ngồi trả lời hộ, không phải người được đo tự làm. */
export function laBanQuanSat(ma: MaBoDe): boolean {
  return ma === "MN" || ma === "QS";
}

export type BoDeChoThanhVien = {
  readonly boDe: MaBoDe;
  /** Lý do bị chuyển sang bản quan sát — PHẢI hiện ra, không được chuyển im lặng. */
  readonly giaiThich?: MaGiaiThich;
  /** `true` ⇒ màn dặn dò phải nói rõ "bố mẹ trả lời giúp", không nói "em tự đọc". */
  readonly nguoiLonTraLoiHo: boolean;
};

/**
 * BỘ ĐỀ SUY TỪ VAI + BẬC HỌC CỦA MỘT NGƯỜI TRONG SỔ — không hỏi lại một câu nào.
 *
 * 🔴 HÀM NÀY SỬA MỘT LỖI CHẶN THẬT. Bản trước nằm trong `app/khoang/disc.tsx`, chỉ đọc
 * `tv.lop` rồi `Number(tv.lop)`, và **không đọc `vaiTro` một lần nào**. Hậu quả:
 *
 *   - Bố mẹ · ông bà · người thân KHÔNG có lớp ⇒ `null` ⇒ bấm *Làm bài* trên thẻ của
 *     chính mình thì bị đá về màn *"Ai đang cầm máy?"* và bị hỏi lại từ đầu.
 *   - Trẻ mầm non ⇒ `Number("mam-non")` ra `NaN` ⇒ cũng `null`, cũng bị đá về.
 *
 * Tức là đúng nhóm người mà cả GĐ11–GĐ14 xây cho lại là nhóm không đi vào được.
 *
 * 🔴 LỖI THỨ HAI, ÂM THẦM HƠN: bản trước trả về mỗi bộ đề và **vứt `giaiThich`**. Một em
 * lớp 1–2 vào bài từ thẻ sẽ bị chuyển sang bản quan sát mà KHÔNG có hộp giải thích —
 * trong khi `DISC_BA.md` §4.2 ghi rõ văn bản đó là BẮT BUỘC hiện, và chuyển im lặng là
 * lừa người dùng. Nay `giaiThich` được chuyền ra ngoài.
 *
 * Vẫn đi xuyên qua `dinhTuyen()`: luật ADR-002 (sàn tự đánh giá 8 tuổi) là thứ đắt nhất
 * trong sản phẩm và chỉ được có ĐÚNG MỘT nơi giữ.
 *
 * Trả `null` khi chưa đủ dữ kiện (người đi học mà chưa chọn bậc) — đoán bừa một bộ đề cho
 * một đứa trẻ là chuyện không được phép làm để tiết kiệm một cú chạm.
 */
export function boDeChoThanhVien(
  vaiTro: VaiGiaDinh,
  lop: string | undefined,
): BoDeChoThanhVien | null {
  const goi = (kq: KetQuaDinhTuyen): BoDeChoThanhVien | null =>
    kq.xong
      ? {
          boDe: kq.boDe,
          ...(kq.giaiThich ? { giaiThich: kq.giaiThich } : {}),
          nguoiLonTraLoiHo: laBanQuanSat(kq.boDe),
        }
      : null;

  // Vai không đi học ⇒ bản TỰ ĐÁNH GIÁ cho người lớn. Không hỏi mục tiêu: từ V1.3 thẻ của
  // người lớn chỉ có bài về CHÍNH HỌ; bài quan sát về con nằm ở thẻ của đứa trẻ.
  if (!coHoiLop(vaiTro)) return goi(dinhTuyen({ doiTuong: "phu-huynh", mucTieu: "toi" }));

  if (lop === LOP_MAM_NON) return goi(dinhTuyen({ doiTuong: "mam-non" }));
  if (lop === LOP_TREN_12) return goi(dinhTuyen({ doiTuong: "cap-ba-tro-len" }));

  const so = soLopCua(lop);
  if (so === undefined) return null; // đang đi học mà chưa chọn bậc — phải hỏi, không đoán.

  if (so >= LOP_DAU_CAP_BA) return goi(dinhTuyen({ doiTuong: "cap-ba-tro-len", lop: so }));
  if (so <= LOP_CUOI_TIEU_HOC) return goi(dinhTuyen({ doiTuong: "tieu-hoc", lop: so }));
  return goi(dinhTuyen({ doiTuong: "thcs", lop: so }));
}

/**
 * Bộ đề khi NGƯỜI LỚN trả lời về một đứa trẻ trong sổ — nút phụ trên thẻ của trẻ (V1.4).
 *
 * 🔴 GÁC BẰNG LỚP, KHÔNG BẰNG TUỔI SUY RA. `dinhTuyen()` gác bộ QS bằng `tuoiCon >= 8`,
 * nhưng sổ gia đình chỉ có LỚP. Suy tuổi từ lớp rồi chuyền vào là bịa một con số chưa ai
 * nhập — lớp 4 có cả bé 9 lẫn bé 10. Nên cửa ADR-002 ở đây phát biểu lại bằng lớp, và
 * `tests/dinh-tuyen.test.ts` canh cho hai cách phát biểu không bao giờ lệch nhau.
 *
 * Mầm non và lớp 1–2 trả `MN`: bài chính của các em VỐN ĐÃ là bản người lớn trả lời, nên
 * thẻ của các em không cần nút phụ nào.
 */
export function boDeQuanSatTheoLop(lop: string | undefined): MaBoDe | null {
  if (lop === LOP_MAM_NON) return "MN";
  const so = soLopCua(lop);
  if (so === undefined) return null;
  return so <= LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT ? "MN" : "QS";
}

/**
 * Bộ đề mà một đứa trẻ TỰ LÀM ở tuổi này.
 *
 * 🔴 Sinh ra để vá một lỗi thật: màn vùng lệch gõ cứng `thieuBaiCon ? "THCS" : "QS"`, nên
 * con 8–10 tuổi bị mời làm bộ THCS. Bộ QS trải từ 8 đến 15 tuổi — bắc qua CẢ hai bộ tự làm
 * — nên không có cách nào chọn đúng nếu không nhìn vào tuổi.
 *
 * Không biết tuổi thì trả về bộ của lứa NHỎ HƠN, không phải bộ lớn hơn: bản ghi cũ (lưu
 * trước khi trường `tuoi` tồn tại) có thể là của một bé vừa tròn 8, và đưa nhầm một em lớp
 * 3 vào bộ THCS tệ hơn là đưa nhầm một em lớp 8 vào bộ Tiểu học.
 *
 * Dưới sàn tự đánh giá thì trả `null` — ADR-002: trẻ dưới 8 tuổi không tự đánh giá được,
 * và mời em ấy tự làm bài là đi vòng qua đúng hàng rào đó.
 */
export function boDeConTuLam(tuoi: number | undefined): MaBoDe | null {
  if (tuoi !== undefined && tuoi < TUOI_TU_DANH_GIA_TOI_THIEU) return null;
  return tuoi !== undefined && tuoi >= TUOI_VAO_THCS ? "THCS" : "TH";
}
