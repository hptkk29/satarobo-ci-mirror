// lib/orders/price-guard.ts — so đơn giá client gửi với GIÁ NIÊM YẾT trong DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// LỖ ĐANG MỞ MÀ FILE NÀY ĐÓNG
//
// `createOrderManualAction` tin tuyệt đối `unitPrice` client gửi, và `needsDiscountApproval`
// chỉ xét `discountAmount > 0` — nên đơn hạ ĐƠN GIÁ không vào hàng chờ duyệt, không ghi
// AuditLog nào, mà vẫn tự chốt được qua webhook. Cổng duyệt hiện tại chỉ che ô "Giảm giá",
// KHÔNG che ô "Đơn giá". Chính chú thích trợ giúp trên form đã thừa nhận điều này và xử lý
// nó bằng một lời nhắc.
//
// ─────────────────────────────────────────────────────────────────────────────
// FILE NÀY CHỈ SO VÀ PHÂN LOẠI. NÓ KHÔNG TỪ CHỐI, VÀ KHÔNG QUY LỆCH THÀNH GIẢM GIÁ.
//
// Ba lý do, mỗi lý do tự đủ:
//
//  (a) "cao hơn niêm yết ⇒ từ chối" chặn đúng nghiệp vụ đang bán. Công văn SR.QD.219
//      Điều 5.2: Coach 1-1 ×2,0 · 1-2 ×1,8 · 1-4 ×1,5 — đơn Coach khoá đủ ĐÚNG BẰNG
//      bội số của `Course.price`. `lib/finance/coach-pricing.ts` đã hiện thực đúng thế.
//
//  (b) "thấp hơn niêm yết ⇒ từ chối" chặn việc bán theo học phần: 48 buổi = 4 học phần,
//      bán 1 học phần là 1/4 giá khoá.
//
//  (c) "quy phần lệch thành `discountAmount`" là hướng trông hợp lý nhất và nguy hiểm
//      nhất. `needsDiscountApproval` trả true với MỌI `discountAmount > 0`; `sepay.ts`
//      gặp `PENDING_APPROVAL` trả `MANUAL`; ở webhook cửa ghi sổ CHỈ chạy khi không tra
//      ra đơn ⇒ ca "có đơn + giảm giá chưa duyệt" chỉ ghi IntegrationLog rồi return:
//      không BankTransaction, không PaymentRequest/Allocation, không Payment. Tiền vào
//      tài khoản, ba sổ trống. Cổng đó chưa từng chạy thật trên prod — quy lệch thành
//      giảm giá là BẬT nó lên hàng loạt.
//
// Nên: SO · PHÂN LOẠI · GHI DẤU. Việc "lệch bao nhiêu thì chặn" là CHÍNH SÁCH, và chính
// sách chưa chốt thì không cài cứng vào đường tiền. Khi bảng giá theo công văn được chốt
// và loại đơn (1-1/1-2/1-4) + số học phần có chỗ đứng trong dữ liệu, `giaNiemYet` truyền
// vào đây đổi thành GIÁ KỲ VỌNG tính theo công văn — chữ ký hàm không phải đổi.
// ─────────────────────────────────────────────────────────────────────────────

export const LECH_GIA = {
  KHOP: "KHOP",
  THAP_HON: "THAP_HON",
  CAO_HON: "CAO_HON",
  CHUA_CO_GIA: "CHUA_CO_GIA",
} as const;

export type KetQuaSoGia = (typeof LECH_GIA)[keyof typeof LECH_GIA];

function tien(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function soSanhGia(input: {
  /** `Course.price` / `Product.salePrice`. `null` là ca THẬT — `Course.price` là `Int?`. */
  giaNiemYet: number | null | undefined;
  giaGhi: number;
  /** Tha lệch làm tròn. Mặc định 0 = khớp tuyệt đối. */
  dungSai?: number;
}): { ket: KetQuaSoGia; lech: number } {
  const niemYet = tien(input.giaNiemYet);
  if (niemYet <= 0) return { ket: LECH_GIA.CHUA_CO_GIA, lech: 0 };

  const ghi = tien(input.giaGhi);
  const dungSai = tien(input.dungSai);
  const lech = ghi - niemYet;

  if (Math.abs(lech) <= dungSai) return { ket: LECH_GIA.KHOP, lech: 0 };
  return lech < 0
    ? { ket: LECH_GIA.THAP_HON, lech: -lech }
    : { ket: LECH_GIA.CAO_HON, lech };
}

export type DongDon = {
  itemName: string;
  soLuong: number;
  giaGhi: number;
  giaNiemYet: number | null | undefined;
};

export type DongLech = {
  itemName: string;
  ket: KetQuaSoGia;
  giaNiemYet: number;
  giaGhi: number;
  soLuong: number;
  /** Lệch ĐÃ NHÂN số lượng — hạ 1đ/cái × 2 cái là hụt gấp đôi. */
  lech: number;
};

export type SoatGiaDon = {
  coLech: boolean;
  /** Tổng phần bị hạ THẤP hơn niêm yết. Bán cao hơn KHÔNG cộng vào đây. */
  tongLechThap: number;
  dongLech: DongLech[];
};

/** Soát cả đơn, trả dấu vết đủ để người khác soát lại mà không cần mở lại payload. */
export function soatGiaDon(dong: DongDon[], dungSai = 0): SoatGiaDon {
  const dongLech: DongLech[] = [];
  let tongLechThap = 0;

  for (const d of dong) {
    const soLuong = Math.max(0, Math.round(Number.isFinite(d.soLuong) ? d.soLuong : 0));
    const { ket, lech } = soSanhGia({
      giaNiemYet: d.giaNiemYet,
      giaGhi: d.giaGhi,
      dungSai,
    });
    if (ket === LECH_GIA.KHOP) continue;

    const lechTong = lech * soLuong;
    if (ket === LECH_GIA.THAP_HON) tongLechThap += lechTong;

    dongLech.push({
      itemName: d.itemName,
      ket,
      giaNiemYet: tien(d.giaNiemYet),
      giaGhi: tien(d.giaGhi),
      soLuong,
      lech: lechTong,
    });
  }

  return { coLech: dongLech.length > 0, tongLechThap, dongLech };
}
