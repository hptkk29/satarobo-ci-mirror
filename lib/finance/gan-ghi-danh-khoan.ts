// lib/finance/gan-ghi-danh-khoan.ts — chọn GHI DANH cho một khoản thu chưa gắn.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Chủ dự án 14/09/2026, chỉ vào màn Thanh toán: "bấm xem thử xong chỉ xem và không có
// thao tác gì nữa à?"
//
// Khối "Học phí nhập từ file Excel" đếm được số khoản bị bỏ và nêu lý do, nhưng không cho
// làm gì với chúng. Mà lý do phổ biến nhất — `LY_DO_BO.CHUA_GAN_GHI_DANH` ("không sinh
// được phiếu thu") — là thứ SỬA ĐƯỢC: chỉ cần trỏ khoản vào đúng ghi danh của em. Không
// có đường sửa thì tiền nằm mãi ở trạng thái chờ, và cổng phụ huynh vẫn hiện nợ dù nhà đã
// đóng — đúng cái bệnh mà cả đợt này đi chữa.
//
// ─────────────────────────────────────────────────────────────────────────────
// GIỮ NGUYÊN LUẬT CỦA ĐƯỜNG NHẬP: gợi ý khi chắc, bắt chọn khi mơ hồ
//
// `ghi-giao-dich-cu.ts` cũng tự gắn, nhưng CHỈ khi không mơ hồ — đúng một ghi danh còn
// sống. Em học hai lớp thì phải chia tiền theo `finalPrice`, và đoán hộ ở đó là ghi tiền
// vào lớp sai: khoản đã gắn rồi thì công nợ của lớp kia vẫn nguyên, và không ai biết.
// Hàm này giữ đúng luật đó ở tầng sửa tay.
//
// THUẦN — không Prisma, không DB. Người gọi tra ghi danh rồi truyền vào.
// ─────────────────────────────────────────────────────────────────────────────

import {
  NGUON_KHOAN,
  NHAN_NGUON_KHOAN,
  nguonKhoan,
  type NguonKhoan,
} from "@/lib/finance/payment-markers";
import { LY_DO_BO, nenXacNhanHangLoat } from "@/lib/finance/backfill-confirm";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";

export const MUC_GAN = {
  /** Đúng một ghi danh còn sống ⇒ gợi ý sẵn, người dùng chỉ việc xác nhận. */
  CHAC_CHAN: "CHAC_CHAN",
  /** Nhiều ghi danh ⇒ PHẢI có người chọn. Không bao giờ tự lấy một cái. */
  PHAI_CHON: "PHAI_CHON",
  /** Em chưa có ghi danh nào ⇒ việc phải làm nằm ở màn khác, không phải ở đây. */
  KHONG_CO: "KHONG_CO",
  /**
   * Khoản ĐÃ gắn ghi danh rồi — nó nằm trong danh sách vì một vướng mắc KHÁC
   * (ví dụ "bạn là người ghi nhận khoản này").
   *
   * ⚠️ Có mức này vì LUẬT 12 (affordance phải nói thật), không phải cho đẹp. Trước đó
   * action gọi thẳng `chonGhiDanhChoKhoan(danh sách ghi danh của em)`, nên một khoản ĐÃ
   * gắn mà em chỉ học một lớp sẽ ra `CHAC_CHAN` ⇒ màn bày ô chọn + nút "Gắn" ⇒ bấm vào
   * thì `ganGhiDanhChoKhoanAction` từ chối ("Khoản này đã gắn ghi danh rồi"). Nút hứa
   * một việc mà đường ghi cấm — không test nào đỏ, console vẫn sạch, chỉ người bấm mới
   * biết.
   */
  DA_GAN: "DA_GAN",
  /**
   * Đơn mang khoản này KHÔNG gắn học viên nào (đơn tạo ở `/orders/new` không tạo
   * `Enrollment`, và `Order.studentId` để trống được).
   *
   * KHÁC HẲN `KHONG_CO`: ở `KHONG_CO` ta biết em nào, chỉ là em chưa được xếp lớp ⇒ đi
   * tạo ghi danh. Ở đây không biết là em nào ⇒ tạo ghi danh cho AI? Việc phải làm là mở
   * đơn và gắn học viên. Gộp hai ca vào một nhãn là chỉ người dùng sang một màn không
   * giải quyết được gì.
   */
  THIEU_HOC_VIEN: "THIEU_HOC_VIEN",
} as const;
export type MucGan = (typeof MUC_GAN)[keyof typeof MUC_GAN];

export const NHAN_MUC_GAN: Record<MucGan, string> = {
  CHAC_CHAN: "Chỉ có một lớp — gắn được ngay",
  PHAI_CHON: "Em học nhiều lớp — chọn đúng lớp đã đóng tiền",
  KHONG_CO: "Em chưa có ghi danh nào",
  DA_GAN: "Đã gắn lớp rồi — vướng lý do khác",
  THIEU_HOC_VIEN: "Đơn chưa gắn học viên",
};

export type GhiDanhUngVien = {
  id: string;
  tenLop: string | null;
  tenKhoa: string | null;
  /** `null` = chưa chốt giá. VẪN là ứng viên hợp lệ — xem `[GGK-04]`. */
  finalPrice: number | null;
};

export type KetQuaChonGhiDanh = {
  muc: MucGan;
  /** Chỉ có giá trị ở mức `CHAC_CHAN`. Mơ hồ thì `null` — người chọn, không phải máy. */
  ghiDanhId: string | null;
  ungVien: GhiDanhUngVien[];
};

export function chonGhiDanhChoKhoan(ghiDanh: GhiDanhUngVien[]): KetQuaChonGhiDanh {
  if (ghiDanh.length === 0) {
    return { muc: MUC_GAN.KHONG_CO, ghiDanhId: null, ungVien: [] };
  }
  if (ghiDanh.length === 1) {
    return { muc: MUC_GAN.CHAC_CHAN, ghiDanhId: ghiDanh[0]!.id, ungVien: ghiDanh };
  }
  return { muc: MUC_GAN.PHAI_CHON, ghiDanhId: null, ungVien: ghiDanh };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI ĐƯỢC VÀO DANH SÁCH "KHOẢN BỊ BỎ" — VÀ VÌ SAO
//
// ─── CON BUG ĐÃ ĐO (14/09/2026) ──────────────────────────────────────────────
// `khoanBiBoAction` (app/(admin)/admin/payments/_actions.ts) tra DB bằng
//     note: { contains: BACKFILL_PAYMENT_MARKER }
// tức CHỈ khoản `[backfill-import]`. Nhưng đường sinh khoản thứ hai —
// `lib/payments/payos-ingest.ts:1120` — ghi `Payment` với marker `[auto:<provider>:<txn>]`
// và **CỐ Ý để `enrollmentId = null` khi mơ hồ** (em có ≥2 ghi danh sống, hoặc đơn không
// gắn học viên). Chú thích ngay tại đó nói rõ: để null là nhường cho NGƯỜI quyết, vì đoán
// hộ là cộng tiền vào công nợ của khoá khác.
//
// Người đó không có màn nào để quyết. Khoản cổng không mang `[backfill-import]` nên bộ
// lọc trên giấu nó đi: tiền thật đã vào tài khoản, đã có dòng trong sổ, `confirmPayment`
// từ chối vì `!enrollmentId`, và KHÔNG thao tác nào đưa nó vào công nợ được. Đúng câu chủ
// dự án hỏi: "bấm xem thử xong chỉ xem và không có thao tác gì nữa à?"
//
// ─── VÌ SAO KHÔNG DÙNG THẲNG `lapKeHoachXacNhan` CHO DANH SÁCH NÀY ───────────
// Hai câu hỏi KHÁC NHAU, và lẫn chúng vào nhau chính là cách con bug ra đời:
//   · `nenXacNhanHangLoat` hỏi "khoản này có vào được LƯỢT XÁC NHẬN HÀNG LOẠT của đợt
//     nhập lịch sử không" — nên câu trả lời đầu tiên của nó là `KHONG_PHAI_BACKFILL`;
//   · danh sách này hỏi "đồng tiền này vướng gì, và tôi sửa được không".
// Mở bộ lọc DB rồi vẫn hỏi câu thứ nhất thì mọi khoản cổng hiện ra với lý do "Không phải
// khoản nhập liệu ban đầu" — đúng về chữ, vô dụng với người đang cầm chuột.
//
// Nhưng với khoản backfill thì PHẢI trả lời y hệt khối "Xem thử" ở trên, kẻo danh sách
// và con số đếm lệch nhau mà người dùng không có cách nào biết cái nào đúng. Nên nhánh
// backfill ở đây ỦY QUYỀN cho chính `nenXacNhanHangLoat` — dùng chung ATOM, không chép
// luật.

/** Phần dữ liệu một khoản mà luật này cần — cố ý hẹp để test khỏi dựng cả Payment. */
export type KhoanChoGan = {
  id: string;
  note: string | null;
  accountantStatus: string;
  /** `PAYMENT` | `ADJUSTMENT` (`Payment.paymentType`). */
  paymentType: string;
  enrollmentId: string | null;
  recordedById: string | null;
  amount: number;
  /** `Order.type` (`null` = không có đơn). Đơn KIT/THI không có ghi danh để gắn — `can-ghi-danh.ts`. */
  loaiDon: string | null;
};

export type VuongMacKhoan =
  | { hien: false }
  | {
      hien: true;
      /** Lý do máy đọc được — trùng `LY_DO_BO` để đếm/nhóm được. */
      lyDo: string;
      nguon: NguonKhoan;
      /** Gắn ghi danh có sửa được khoản này không. `false` ⇒ màn KHÔNG được bày nút Gắn. */
      ganDuoc: boolean;
    };

/**
 * Khoản này có thuộc danh sách "bị bỏ / chờ gắn" không, và vướng gì.
 *
 * ⚠️ BA NHÓM LOẠI CỨNG dưới đây trùng với điều kiện `where` của câu tra, CÓ CHỦ ĐÍCH:
 * `where` là để DB khỏi kéo về dữ liệu thừa, còn đây mới là chỗ PHÁT BIỂU luật và là chỗ
 * cấy lỗi kiểm được. Bỏ một trong hai là mất một nửa.
 *
 *  · `ADJUSTMENT` — bút toán điều chỉnh giữ DELTA và trỏ `adjustmentOfId` về phiếu gốc
 *    (`lib/finance/payment.ts:712-731`). Gắn ghi danh cho một delta là gắn nhầm tầng:
 *    ghi danh thuộc về phiếu gốc. Đo trên satarobo_local 14/09: 0 dòng ADJUSTMENT, tức
 *    đây là lưới chặn TRƯỚC khi có dữ liệu, không phải vá sau sự cố.
 *  · `amount <= 0` — hoàn tiền tạo dòng MỚI mang số ÂM (`refundPayment`, payment.ts:888).
 *    Trả lại tiền cho phụ huynh không phải "khoản chưa có chỗ đậu".
 *  · `accountantStatus !== PENDING` — CONFIRMED đã vào công nợ; REJECTED là kế toán đã
 *    từ chối có lý do; REFUNDED là đã hoàn. Cả ba đều ĐÃ có người quyết xong; bày lại ở
 *    danh sách việc-phải-làm là mời người ta quyết lần thứ hai.
 *    (Hai dòng trên thực ra cũng không bao giờ PENDING — refund ghi `REFUNDED`, adjustment
 *    ghi `CONFIRMED` — nhưng luật phải nói ra lý do của chính nó, không dựa vào trùng hợp.)
 */
export function vuongMacCuaKhoan(p: KhoanChoGan, actorId: string): VuongMacKhoan {
  if (p.paymentType === "ADJUSTMENT") return { hien: false };
  if (!Number.isFinite(p.amount) || p.amount <= 0) return { hien: false };
  if (p.accountantStatus !== "PENDING") return { hien: false };

  const nguon = nguonKhoan(p.note);

  if (nguon === NGUON_KHOAN.NHAP_LICH_SU) {
    // Ủy quyền — xem khối chú thích trên. Khoản ĐƯỢC NHẬN vào lượt hàng loạt thì không
    // phải "bị bỏ", nên không hiện.
    const v = nenXacNhanHangLoat(p, actorId);
    if (v.nhan) return { hien: false };
    return { hien: true, lyDo: v.lyDo, nguon, ganDuoc: !p.enrollmentId };
  }

  // Không phải khoản nhập lịch sử ⇒ nó KHÔNG thuộc lượt xác nhận hàng loạt, nên "bị bỏ"
  // không có nghĩa gì với nó. Chỉ hiện khi TIỀN CHƯA CÓ CHỖ ĐẬU — đó là việc sửa được ở
  // màn này, và là thứ chặn `confirmPayment`.
  //
  // ⚠️ KHÔNG hiện mọi khoản PENDING còn lại: 44/45 khoản PENDING trên satarobo_local đã
  // có `enrollmentId` và chỉ đang chờ kế toán bấm xác nhận từng cái ở bảng chính. Đổ hết
  // vào đây là biến danh sách việc-phải-làm thành bản sao của bảng Thanh toán.
  // Đơn KIT/THI (29/09/2026) không có ghi danh nào để gắn và `confirmPayment` đã nhận nó ⇒ bày ở
  // đây kèm nút Gắn là lời hứa suông. Hỏi CÙNG hàm với lõi xác nhận, không viết điều kiện riêng.
  if (!thieuGhiDanh(p, p.loaiDon)) return { hien: false };
  return { hien: true, lyDo: LY_DO_BO.CHUA_GAN_GHI_DANH, nguon, ganDuoc: true };
}

/**
 * Dòng chữ hiện dưới tên học viên: vướng gì · từ đâu tới · (nếu có) việc phải làm.
 *
 * Nhãn NGUỒN đi kèm vì sau bản vá danh sách trộn nhiều nguồn. "Chưa gắn ghi danh" của
 * một khoản nhập Excel và của một khoản tiền về qua QR là hai tình huống khác hẳn nhau —
 * cái sau nghĩa là KHÁCH ĐÃ CHUYỂN TIỀN THẬT và hệ thống đang chờ người chỉ chỗ. Không
 * nói nguồn thì người vận hành không phân biệt được, mà cả hai cùng một câu chữ.
 */
export function dongVuongMac(
  lyDo: string,
  nguon: NguonKhoan,
  viecPhaiLam?: string | null,
): string {
  return [lyDo, NHAN_NGUON_KHOAN[nguon], viecPhaiLam].filter(Boolean).join(" · ");
}

/**
 * Mức gắn cho MỘT dòng trên màn — bao gồm cả hai ca mà `chonGhiDanhChoKhoan` không thấy.
 *
 * `chonGhiDanhChoKhoan` chỉ nhìn DANH SÁCH GHI DANH, nên nó không phân biệt nổi
 * "em chưa có lớp" với "đơn không biết là em nào" (cả hai đều ra mảng rỗng ⇒ `KHONG_CO`
 * ⇒ màn chỉ sang trang Ghi danh), và nó không biết khoản đã gắn rồi. Hai lỗ đó đều đẻ
 * ra lời hứa suông trên giao diện — xem chú thích ở `MUC_GAN.DA_GAN`.
 */
export function mucGanChoKhoan(input: {
  daGanGhiDanh: boolean;
  coHocVien: boolean;
  ghiDanh: GhiDanhUngVien[];
}): KetQuaChonGhiDanh {
  if (input.daGanGhiDanh) return { muc: MUC_GAN.DA_GAN, ghiDanhId: null, ungVien: [] };
  if (!input.coHocVien) return { muc: MUC_GAN.THIEU_HOC_VIEN, ghiDanhId: null, ungVien: [] };
  return chonGhiDanhChoKhoan(input.ghiDanh);
}
