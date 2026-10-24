// lib/entitlements/hoan-tien.ts — HOÀN TIỀN THEO LẦN MUA (QĐ-47/48). THUẦN.
//
//   hoàn = (purchaseSessions − consumed − skipped) × netAmount ÷ purchaseSessions
//
// · `netAmount` là số tiền thực thu của LẦN MUA ĐÓ (đã sau giảm), chụp lúc cấp quyền học. Không tính
//   lại theo Bảng A khi hoàn giữa chừng (QĐ-48).
// · KHÔNG làm tròn (QĐ-34): không chia hết ⇒ ném `LoiHoanTien("REFUND_NOT_INTEGER")` để người xử lý
//   quyết định, thay vì lặng lẽ lệch vài đồng.
// · `baiBoQuaCoHoan` (MM-10 — CHƯA CHỐT): bài bỏ qua vì vượt trần học vượt có được hoàn không. Mặc
//   định `false` (không hoàn) là theo BA, nhưng lệch chữ QĐ-24 "không mất phạm vi đã mua" — là THAM SỐ.

export class LoiHoanTien extends Error {
  constructor(
    public readonly ma: "DAU_VAO_KHONG_HOP_LE" | "REFUND_NOT_INTEGER",
    message: string,
  ) {
    super(message);
    this.name = "LoiHoanTien";
  }
}

export interface DauVaoHoanTien {
  readonly purchaseSessions: number;
  readonly daTieuThu: number;
  readonly soBaiBoQua: number;
  readonly netAmount: number;
  readonly baiBoQuaCoHoan?: boolean;
}

export interface KetQuaHoanTien {
  readonly soBuoiChuaHoc: number;
  readonly soTienHoan: number;
}

export function tinhHoanTien(vao: DauVaoHoanTien): KetQuaHoanTien {
  const { purchaseSessions: n, daTieuThu, soBaiBoQua, netAmount } = vao;
  const nguyen = (x: number) => Number.isInteger(x) && x >= 0;
  if (!Number.isInteger(n) || n < 1 || !nguyen(daTieuThu) || !nguyen(soBaiBoQua) || !nguyen(netAmount)) {
    throw new LoiHoanTien("DAU_VAO_KHONG_HOP_LE", "Số buổi / số tiền hoàn không hợp lệ.");
  }
  const truBoQua = vao.baiBoQuaCoHoan === true ? 0 : soBaiBoQua;
  const chuaHoc = n - daTieuThu - truBoQua;
  if (chuaHoc < 0) {
    throw new LoiHoanTien("DAU_VAO_KHONG_HOP_LE", "Đã học + bỏ qua vượt số buổi đã mua.");
  }
  const tu = chuaHoc * netAmount;
  if (tu % n !== 0) {
    throw new LoiHoanTien("REFUND_NOT_INTEGER", "Số tiền hoàn không ra số nguyên đồng.");
  }
  return { soBuoiChuaHoc: chuaHoc, soTienHoan: tu / n };
}
