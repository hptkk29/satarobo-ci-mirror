// lib/hoa-hong/nhom-hoa-hong.ts — TÁCH vai hưởng thành «Hoa hồng nguồn (acquisition)» và «Hoa hồng giao dịch khác» theo `BeneficiaryRole.isAcquisition`. THUẦN, an toàn cho client.
//
// Dùng ở hai nơi người đọc nhìn bảng vai × tỉ lệ: ma trận chính sách và chi tiết một phiên bản. Hai nhóm khác bản chất — nhóm nguồn chỉ tính trong cửa sổ ghi công và đi theo NGUỒN
// của lead; nhóm giao dịch đi theo vai trong giao dịch — nên một bảng phẳng khiến người đọc cộng nhầm hai loại vào cùng một «nguồn».
//
// ⚠️ Tách CHỖ NGỒI, không tách TỔNG: trần 9% đếm cả hai nhóm (kiểm trần ở máy chủ cộng mọi vai), nên hàng «Tổng» vẫn là MỘT hàng cho cả bảng. Tách cả tổng là cho người đọc
// thấy hai con số dưới trần trong khi cộng lại vượt.
import { NHAN_NHOM_HOA_HONG, type KhoaNhomHoaHong } from "@/lib/nguon/nhan-hien-thi";

export type NhomVai<T> = { khoa: KhoaNhomHoaHong; nhan: string; vai: T[] };

/**
 * Thứ tự cố định: nhóm giao dịch trước (các tầng quen thuộc: Sale, QLCS…), nhóm nguồn sau. Nhóm RỖNG bị bỏ (không vẽ tiêu đề cho một nhóm không có dòng).
 * Thứ tự trong từng nhóm GIỮ NGUYÊN đầu vào.
 */
export function tachNhomVai<T extends { isAcquisition: boolean }>(vai: readonly T[]): NhomVai<T>[] {
  const giaoDich = vai.filter((v) => !v.isAcquisition);
  const nguon = vai.filter((v) => v.isAcquisition);
  return [
    { khoa: "GIAO_DICH" as const, nhan: NHAN_NHOM_HOA_HONG.GIAO_DICH, vai: giaoDich },
    { khoa: "NGUON" as const, nhan: NHAN_NHOM_HOA_HONG.NGUON, vai: nguon },
  ].filter((n) => n.vai.length > 0);
}
