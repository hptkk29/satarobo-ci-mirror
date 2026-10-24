// lib/finance/hoa-don/bao-cao-sai-phap-nhan.ts — phần THUẦN của báo cáo chỉ-đọc "hoá đơn nghi lưu sai pháp nhân"
// (scripts/bao-cao-hoa-don-sai-phap-nhan.ts). Tách ra để có test mà không cần DB.

/** Một hoá đơn như script đọc từ DB — chỉ cột của NGƯỜI BÁN, không cột nào của người mua. */
export type HoaDonDoPhapNhan = {
  id: string;
  maCoSo: string;
  trangThai: string;
  kyHieu: string | null;
  soHoaDon: string | null;
  /** yyyy-mm-dd hoặc "" */
  ngayPhatHanh: string;
  phapNhanMa: string | null;
  phapNhanMst: string | null;
  coTepPdf: boolean;
};

/**
 * Quy tắc "cơ sở X phát hành ký hiệu Y thì pháp nhân đúng phải là Z". KHAI TƯỜNG MINH, kèm nguồn — không suy.
 * Thêm một quy tắc = thêm một dòng ở đây, không sửa script.
 */
export const DONG_NGHI_SAI_PHAP_NHAN: readonly { maCoSo: string; kyHieu: string; phapNhanMaDuKien: string; nguon: string }[] = [
  {
    maCoSo: "CS2",
    kyHieu: "1C26MNV",
    phapNhanMaDuKien: "NEW_VISION",
    nguon:
      "Chủ dự án xác nhận 23/10/2026: CS2 phát hành dưới New Vision trên VIN HOADON; ký hiệu 1C26MNV đo từ tờ 1C26MNV-13 (29/08/2026) — phap-nhan.ts",
  },
];

/** Các số bị thiếu giữa số nhỏ nhất và lớn nhất của một dãy (đầu vào đã sắp xếp tăng). Tối đa `tran` số. */
export function soThieuTrongDai(daSapXep: readonly number[], tran = 200): number[] {
  const co = new Set(daSapXep);
  if (co.size === 0) return [];
  const mn = daSapXep[0]!;
  const mx = daSapXep[daSapXep.length - 1]!;
  const thieu: number[] = [];
  for (let n = mn; n <= mx && thieu.length < tran; n++) if (!co.has(n)) thieu.push(n);
  return thieu;
}
