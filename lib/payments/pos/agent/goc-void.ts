// lib/payments/pos/agent/goc-void.ts — GỐC của một dòng VOID không mang mã giao dịch gốc (GĐ4 POS — T9). THUẦN.
//
// List API portal (chưa đo — Chờ đo DevTools, hợp đồng §10) có thể không mang "mã giao dịch gốc". Hợp đồng
// §6.2: gốc = dòng `PAYMENT` DUY NHẤT cùng `card_transaction_id` (RRN — dòng VOID dùng chung với dòng gốc) +
// cùng `terminal_code`, giờ ≤ giờ VOID. 0 hoặc ≥ 2 ⇒ `null` (lõi ra "Chưa thấy giao dịch gốc", CAN_XU_LY —
// kế toán quyết); KHÔNG đoán khi mơ hồ. Gốc tới SAU ⇒ `nhanGiaoDichAgent` điền gốc cho VOID đã lưu rồi lõi
// tự xét lại (vòng "XÉT LẠI dòng hủy ĐÃ LƯU" của `nhapLoPos`).
import { chuanMa } from "./may";

export type UngVienGoc = {
  maGiaoDich: string;
  maGiaoDichThe: string | null;
  maQuay: string | null;
  thoiGian: Date;
  /** Loại "Thanh toán" (đã qua cùng phép chuẩn hoá của lõi). */
  laThanhToan: boolean;
};

export function ganGocVoid(x: {
  void: { maGiaoDichThe: string | null; maQuay: string | null; thoiGian: Date };
  ungVien: readonly UngVienGoc[];
}): string | null {
  const rrn = (x.void.maGiaoDichThe ?? "").trim();
  const quay = chuanMa(x.void.maQuay);
  if (rrn === "" || quay === "") return null;
  const ma = new Set(
    x.ungVien
      .filter(
        (u) =>
          u.laThanhToan &&
          (u.maGiaoDichThe ?? "").trim() === rrn &&
          chuanMa(u.maQuay) === quay &&
          u.thoiGian.getTime() <= x.void.thoiGian.getTime(),
      )
      .map((u) => u.maGiaoDich),
  );
  return ma.size === 1 ? [...ma][0]! : null;
}

/**
 * Rà đối kháng bản gộp GĐ3 × GĐ4 (RVG-02) — các dòng THANH TOÁN mà một dòng hủy/hoàn BỊ TỪ CHỐI (không đọc được) có thể
 * hủy. Phép ghép để BẢO VỆ (không tự ghi tiền / bật cảnh báo cho kế toán), KHÔNG để nối gốc ⇒ RỘNG hơn `ganGocVoid`:
 * mọi ứng viên (không đòi đúng một); quầy chỉ so khi dòng hủy có quầy; giờ chỉ so khi dòng hủy đọc được giờ. RRN trống
 * ⇒ không ghép được (không đoán theo giờ / quầy).
 */
export function thanhToanCuaHuyKhongDoc(x: {
  huy: { maGiaoDichThe: string | null; maQuay: string | null; thoiGian: Date | null };
  ungVien: readonly UngVienGoc[];
}): string[] {
  const rrn = (x.huy.maGiaoDichThe ?? "").trim();
  if (rrn === "") return [];
  const quay = chuanMa(x.huy.maQuay);
  const den = x.huy.thoiGian?.getTime() ?? null;
  return [
    ...new Set(
      x.ungVien
        .filter(
          (u) =>
            u.laThanhToan &&
            (u.maGiaoDichThe ?? "").trim() === rrn &&
            (quay === "" || chuanMa(u.maQuay) === quay) &&
            (den === null || u.thoiGian.getTime() <= den),
        )
        .map((u) => u.maGiaoDich),
    ),
  ];
}
