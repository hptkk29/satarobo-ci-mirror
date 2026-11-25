// lib/payments/pos/cat-lo-pos.ts — Cắt các dòng của MỘT file POS thành các lô gửi lên server.
// THUẦN, chạy ở trình duyệt (màn import) lẫn test.
//
// Ba việc, cả ba từng là lỗi (29/09/2026):
//
//  1. Dòng THANH TOÁN đi trước dòng HỦY trên CẢ FILE (giữ thứ tự cũ trong mỗi nhóm). File ngân
//     hàng xếp giờ giảm dần ⇒ dòng Hủy (giờ muộn hơn) rơi vào lô 1, gốc vào lô 2 ⇒ dòng Hủy kẹt
//     "Chưa thấy giao dịch gốc" (ca `[POS-CL-01]`). Server cũng tự xét lại (`[POS-DB-17]`) — đây
//     chỉ là để đa số ca xong ngay trong một lượt.
//  2. Mỗi lô mang kèm các dòng hủy/hoàn (bản TÓM) của cả file trỏ vào dòng TRONG LÔ ĐÓ — không
//     gửi lại cả danh sách của cả file ở mọi lô, và KHÔNG tự tính "mã gốc bị hủy": server tự
//     phân loại (dòng hủy "Thất bại" / hoàn một phần không được làm gốc bị bỏ qua).
//  3. Cắt theo cả SỐ DÒNG lẫn SỐ BYTE: Server Action có trần body 1 MB; lô 300 dòng ghi chú
//     dài vượt trần ⇒ 413, và import lại chết đúng chỗ đó mãi (ca `[POS-CL-03]`).
import type { DongHuyPos, DongPos } from "./kieu";
import { phanLoaiDongPos } from "./phan-loai-pos";

export const DONG_MOT_LO = 300;
/** Dưới trần 1 MB của Server Action, chừa chỗ cho khung JSON + mã hoá của Next. */
export const TRAN_BYTE_MOT_LO = 600_000;

/**
 * Trần một lượt GỬI (1 MB của Server Action = 1.048.576 byte, chừa khung JSON + mã hoá). Chỉ vượt
 * được khi MỘT dòng (kèm dòng hủy của nó) đã quá lớn — `catLoPos` luôn nhận dòng đầu của lô.
 */
export const TRAN_GUI_MOT_LO = 900_000;

export type LoPos = { dong: DongPos[]; dongHuyCuaFile: DongHuyPos[] };

/**
 * Lô này có vượt trần gửi không — màn import hỏi TRƯỚC khi mở lượt import. Không suy từ lỗi
 * server: Server Action vượt trần body trả 500 và bản production của React thay message bằng
 * câu chung, nên nhánh "đọc message tìm 413" không bao giờ khớp (ca `[POS-CL-04]`).
 */
export function loVuotTran(lo: LoPos): boolean {
  return soByte(lo) > TRAN_GUI_MOT_LO;
}

const CTX = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false } as const;

function soByte(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

function tomHuy(d: DongPos): DongHuyPos {
  return {
    maGiaoDich: d.maGiaoDich,
    loaiGiaoDich: d.loaiGiaoDich,
    trangThai: d.trangThai,
    soTien: d.soTien,
    maGiaoDichGoc: d.maGiaoDichGoc,
    trangThaiHoanHuy: d.trangThaiHoanHuy,
  };
}

export function catLoPos(
  tatCa: readonly DongPos[],
  gioiHan: { dong: number; byte: number } = { dong: DONG_MOT_LO, byte: TRAN_BYTE_MOT_LO },
): LoPos[] {
  // "Là dòng hủy" hỏi ĐÚNG hàm của server (luật 2 — loại ≠ Thanh toán, sau chuẩn hoá NFC/hoa
  // thường), không so chuỗi tay. Dòng "Thất bại" ra BO_QUA ⇒ không phải dòng hủy.
  const laHuy = (d: DongPos) => phanLoaiDongPos(d, CTX).loai === "HUY";
  const laLoaiHuy = (d: DongPos) => d.loaiGiaoDich.normalize("NFC").trim().toLowerCase() !== "thanh toán";

  // Mọi dòng loại Hủy/Hoàn (kể cả "Thất bại" — server tự loại) theo mã gốc.
  const huyTheoGoc = new Map<string, DongHuyPos[]>();
  for (const d of tatCa) {
    const goc = d.maGiaoDichGoc?.trim();
    if (!goc || !laLoaiHuy(d)) continue;
    const ds = huyTheoGoc.get(goc) ?? [];
    ds.push(tomHuy(d));
    huyTheoGoc.set(goc, ds);
  }

  const thuTu = [...tatCa.filter((d) => !laHuy(d)), ...tatCa.filter(laHuy)];

  const lo: LoPos[] = [];
  let hienTai: LoPos = { dong: [], dongHuyCuaFile: [] };
  let byteHienTai = 0;
  for (const d of thuTu) {
    const kem = huyTheoGoc.get(d.maGiaoDich) ?? [];
    const byteDong = soByte(d) + soByte(kem);
    const day = hienTai.dong.length >= gioiHan.dong || (hienTai.dong.length > 0 && byteHienTai + byteDong > gioiHan.byte);
    if (day) {
      lo.push(hienTai);
      hienTai = { dong: [], dongHuyCuaFile: [] };
      byteHienTai = 0;
    }
    hienTai.dong.push(d);
    hienTai.dongHuyCuaFile.push(...kem);
    byteHienTai += byteDong;
  }
  if (hienTai.dong.length > 0) lo.push(hienTai);
  return lo;
}
