// lib/payments/pos/agent/may.ts — suy MÁY POS (⇒ cơ sở) của một dòng agent (GĐ4 POS — T10). THUẦN.
//
// Hợp đồng §6.1: máy = `PosTerminal` ĐANG BẬT có `maNhaCungCap` = `merchant_code` VÀ `maQuay` = `terminal_code`;
// `maCuaHang` đã khai mà ≠ `store_code` ⇒ không nhận. Đúng MỘT máy mới nhận — 0 hoặc ≥ 2 ⇒ `null` (lõi luật 5
// "Thiết bị chưa gán cơ sở", không đoán). KHÔNG đọc `device_id` của dòng (T10 — trùng tên `deviceId` của phiên
// portal mà D10 cấm gửi; whitelist đã loại nó).

export type MayPos = {
  maThietBi: string;
  maQuay: string | null;
  maNhaCungCap: string | null;
  maCuaHang: string | null;
  active: boolean;
  centerId: string;
};

/** So mã của ngân hàng: trim + IN HOA. Trống ⇒ "". */
export function chuanMa(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

export function phanGiaiMay(x: {
  merchantCode: string;
  terminalCode: string | null;
  storeCode: string | null;
  danhSachMay: readonly MayPos[];
}): MayPos | null {
  const merchant = chuanMa(x.merchantCode);
  const quay = chuanMa(x.terminalCode);
  if (merchant === "" || quay === "") return null;
  const cuaHang = chuanMa(x.storeCode);
  const khop = x.danhSachMay.filter(
    (m) =>
      m.active &&
      chuanMa(m.maNhaCungCap) === merchant &&
      chuanMa(m.maQuay) === quay &&
      (chuanMa(m.maCuaHang) === "" || chuanMa(m.maCuaHang) === cuaHang),
  );
  return khop.length === 1 ? khop[0]! : null;
}
