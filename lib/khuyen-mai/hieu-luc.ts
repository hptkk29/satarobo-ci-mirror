// lib/khuyen-mai/hieu-luc.ts — "chính sách khuyến mãi này có hiệu lực vào ngày X không". THUẦN.
//
// MỘT CHỖ DUY NHẤT trả lời câu hỏi đó cho mọi nơi đọc: màn quản trị, màn Tra cứu của Sale,
// và đường chọn mã khi tạo đơn. Mỗi nơi tự viết điều kiện là mỗi nơi có một câu trả lời khác
// nhau cho cùng một chính sách — màn hình nói một đằng, đơn hàng tính một nẻo.
//
// Hiệu lực tính LÚC ĐỌC (luật cứng #8 cùng tinh thần: không cron nào đổi trạng thái). Ngày là
// NGÀY LỊCH VIỆT NAM "YYYY-MM-DD", tính cả hai đầu.
//
// THU HỒI: thu hồi trong ngày D (giờ VN) ⇒ ngày hiệu lực cuối cùng là D − 1. Sale mở màn lúc
// 16:00 ngày D, sau khi BLĐ thu hồi lúc 15:00, phải thấy "đã thu hồi" — không phải "còn tới
// hết ngày". Thu hồi trước cả ngày bắt đầu ⇒ chính sách CHƯA TỪNG có hiệu lực.
import { congNgay, ngayCuaCotDate, ngayVN } from "@/lib/format/thoi-gian-vn";

export type HieuLucVao = {
  /** Cột `@db.Date` (nửa đêm UTC). */
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
};

/** Ngày bắt đầu "YYYY-MM-DD". */
export function ngayBatDau(p: HieuLucVao): string {
  return ngayCuaCotDate(p.validFrom);
}

/** Ngày hiệu lực CUỐI CÙNG thật sự (đã tính thu hồi) "YYYY-MM-DD". */
export function ngayKetThuc(p: HieuLucVao): string {
  const han = ngayCuaCotDate(p.validUntil);
  if (!p.revokedAt) return han;
  const truocThuHoi = congNgay(ngayVN(p.revokedAt), -1);
  return truocThuHoi < han ? truocThuHoi : han;
}

/** Có ngày nào chính sách thật sự áp dụng không (thu hồi trước ngày bắt đầu ⇒ không). */
export function daTungHieuLuc(p: HieuLucVao): boolean {
  return ngayKetThuc(p) >= ngayBatDau(p);
}

export type TrangThaiChinhSach = "sap_ap_dung" | "dang_ap_dung" | "het_han" | "da_thu_hoi";

/**
 * Trạng thái HIỂN THỊ tại ngày `ngay`. Tách "hết hạn" với "đã thu hồi" vì với Sale hai thứ
 * khác nhau: hết hạn là chuyện bình thường, thu hồi sớm là BLĐ đổi ý — cần biết để không hứa
 * với khách một ưu đãi vừa bị rút.
 */
export function trangThaiTai(p: HieuLucVao, ngay: string): TrangThaiChinhSach {
  const ketThuc = ngayKetThuc(p);
  if (p.revokedAt && ngay > ketThuc) return "da_thu_hoi";
  if (ngay < ngayBatDau(p)) return "sap_ap_dung";
  if (ngay > ketThuc) return "het_han";
  return "dang_ap_dung";
}

export function dangHieuLuc(p: HieuLucVao, ngay: string): boolean {
  return trangThaiTai(p, ngay) === "dang_ap_dung";
}

export const NHAN_TRANG_THAI: Record<TrangThaiChinhSach, string> = {
  sap_ap_dung: "Sắp áp dụng",
  dang_ap_dung: "Đang áp dụng",
  het_han: "Hết hạn",
  da_thu_hoi: "Đã thu hồi",
};

/**
 * Chính sách áp ở phạm vi cơ sở `phamVi` (mã OrgUnit) không. `orgUnitCodes` RỖNG = toàn hệ
 * thống ⇒ áp ở mọi nơi. Còn lại: giao nhau ít nhất một mã.
 */
export function apDungTrongPhamVi(orgUnitCodes: readonly string[], phamVi: readonly string[]): boolean {
  if (orgUnitCodes.length === 0) return true;
  const s = new Set(phamVi);
  return orgUnitCodes.some((m) => s.has(m));
}
