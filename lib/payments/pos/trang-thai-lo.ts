// TRẠNG THÁI HIỂN THỊ của một lượt import file POS (nợ 4 — docs/pos-the-smartpos.md). THUẦN.
//
// Ba giá trị trong DB (`PosImportStatus`): DANG_NHAP (lượt đang gửi lô), XONG (client báo
// `ketThucNhapPosAction` sau lô cuối), DUNG_GIUA_CHUNG (client báo khi dừng vì lỗi).
// Lượt bị BỎ DỞ không kịp báo gì (đóng tab, mất mạng) vẫn nằm ở DANG_NHAP — màn SUY "Dừng giữa
// chừng" khi đọc: quá `PHUT_COI_LA_DUNG` phút không có lô nào cập nhật. KHÔNG có cron ghi trạng
// thái này (tinh thần luật cứng #8: hết hạn là thuộc tính khi đọc, không phải một phép ghi).
//
// `now` BẮT BUỘC (luật 19 — hàm không tự đọc đồng hồ).

export type PosImportStatus = "DANG_NHAP" | "XONG" | "DUNG_GIUA_CHUNG";

/** Một lượt DANG_NHAP im quá số phút này ⇒ coi là dừng. Lô chậm nhất đo được chưa tới 1 phút. */
export const PHUT_COI_LA_DUNG = 30;

export type TrangThaiLoHienThi = {
  loai: "DANG_NHAP" | "XONG" | "DUNG";
  nhan: string;
  /** "x/y lô" cho lượt chưa xong; null khi xong hoặc không biết tổng số lô. */
  chiTiet: string | null;
};

export function trangThaiHienThiLo(
  lo: { trangThai: PosImportStatus; soLoTong: number; soLoXong: number; capNhatLuc: Date },
  now: Date,
): TrangThaiLoHienThi {
  // Đủ lô = xong, dù lời báo XONG có tới server hay không (mất mạng / hết phiên / đóng tab sau lô
  // cuối). CÙNG điều kiện server dùng để ghi XONG (`ketThucNhapPosAction`: soLoXong ≥ soLoTong) —
  // rà vòng 4, ca `[POS-LO-06]`: trước đó màn in "Dừng giữa chừng · 5/5 lô" vĩnh viễn (luật 12).
  const duLo = lo.soLoTong > 0 && lo.soLoXong >= lo.soLoTong;
  if (lo.trangThai === "XONG" || duLo) return { loai: "XONG", nhan: "Xong", chiTiet: null };
  const chiTiet = lo.soLoTong > 0 ? `${lo.soLoXong}/${lo.soLoTong} lô` : null;
  const imLang = now.getTime() - lo.capNhatLuc.getTime() > PHUT_COI_LA_DUNG * 60_000;
  if (lo.trangThai === "DUNG_GIUA_CHUNG" || imLang) return { loai: "DUNG", nhan: "Dừng giữa chừng", chiTiet };
  return { loai: "DANG_NHAP", nhan: "Đang nhập", chiTiet };
}
