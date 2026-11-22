// lib/finance/hoa-don/trung-tep.ts — câu báo khi tệp PDF vừa tải đã gắn cho một hoá đơn KHÁC còn hiệu
// lực (GĐ 8 bước 13). THUẦN.
//
// Một tờ hoá đơn (một tệp PDF, nhận ra bằng SHA-256 byte tệp) chỉ gắn cho MỘT hoá đơn còn sống (NHÁP /
// ĐÃ XÁC NHẬN). Tải nhầm tờ của khách A lên lần thu của khách B là gửi MST + tên người mua của A cho B.
// Câu báo KHÔNG lộ gì ngoài phạm vi người xem: tờ đang nằm ở cơ sở khác thì không nói mã đơn.

export type TepDangGiu = {
  id: string;
  orderId: string;
  centerId: string;
  kyHieu: string | null;
  soHoaDon: string | null;
  trangThai: string;
  maDon: string;
};

export function thongDiepTepTrung(ct: TepDangGiu, ngu: { xemDuoc: boolean; cungDon: boolean }): string {
  const so = [ct.kyHieu, ct.soHoaDon].filter(Boolean).join("-") || "(chưa ghi số)";
  const tt = ct.trangThai === "DA_XAC_NHAN" ? "đã xuất" : "nháp";
  const duoi = "mỗi tờ hoá đơn chỉ gắn cho một lần thu. Kiểm lại tệp";
  if (ngu.cungDon) return `Tệp PDF này đã gắn cho hoá đơn ${so} (${tt}) của một lần thu khác trên cùng đơn — ${duoi}`;
  if (ngu.xemDuoc) return `Tệp PDF này đã gắn cho hoá đơn ${so} (${tt}) của đơn ${ct.maDon} — ${duoi}`;
  return "Tệp PDF này đã gắn cho một hoá đơn ở cơ sở khác — kiểm lại tệp";
}
