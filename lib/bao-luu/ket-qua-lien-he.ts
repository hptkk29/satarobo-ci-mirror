// lib/bao-luu/ket-qua-lien-he.ts — THUẦN. KẾT QUẢ của một lần ghi liên hệ phụ huynh (vòng 4, chốt chủ dự án 12/10/2026).
//
// SR.QD.236 chỉ cho DỪNG đồng hồ leo thang khi PHỤ HUYNH PHẢN HỒI. Trước vòng 4 mọi lần "ghi liên hệ" đều dừng 7 ngày — kể cả khi nhân viên gọi
// không ai nghe máy, tức là đo "nhân viên đã bấm nút" chứ không đo "phụ huynh đã trả lời" (M7 mục 3.2).
//
//   PH_DA_PHAN_HOI       ⇒ dừng đồng hồ leo thang tối đa `SO_NGAY_DUNG_LEO_THANG_SAU_LIEN_HE` ngày (cron-ke-hoach.ts)
//   KHONG_LIEN_LAC_DUOC  ⇒ KHÔNG dừng: vẫn leo thang đúng hạn (quá hạn ≥ escalateAfterDays)
//
// Lưu ở `StudentReserveEvent.after.ketQua` của sự kiện CONTACT — KHÔNG thêm cột (nhật ký bất biến, không cần migration).
// Sự kiện CONTACT cũ không có khoá này ⇒ `null` ⇒ coi là KHÔNG liên lạc được: sai về phía AN TOÀN (vẫn leo thang, không im lặng bỏ rơi hồ sơ).

export const KET_QUA_LIEN_HE = ["PH_DA_PHAN_HOI", "KHONG_LIEN_LAC_DUOC"] as const;
export type KetQuaLienHe = (typeof KET_QUA_LIEN_HE)[number];

export const NHAN_KET_QUA_LIEN_HE: Record<KetQuaLienHe, string> = {
  PH_DA_PHAN_HOI: "Phụ huynh đã phản hồi",
  KHONG_LIEN_LAC_DUOC: "Không liên lạc được",
};

export const LOI_THIEU_KET_QUA_LIEN_HE = "Chọn kết quả liên hệ: phụ huynh đã phản hồi hay không liên lạc được.";

export function laKetQuaLienHe(v: unknown): v is KetQuaLienHe {
  return typeof v === "string" && (KET_QUA_LIEN_HE as readonly string[]).includes(v);
}

/** Đọc kết quả từ `after` của sự kiện CONTACT. Không có / không hợp lệ (dữ liệu cũ) ⇒ `null`. */
export function docKetQuaLienHe(after: unknown): KetQuaLienHe | null {
  if (after === null || typeof after !== "object" || Array.isArray(after)) return null;
  const v = (after as Record<string, unknown>).ketQua;
  return laKetQuaLienHe(v) ? v : null;
}

/** Chỉ "phụ huynh đã phản hồi" mới dừng đồng hồ leo thang. `null` (dữ liệu cũ) KHÔNG dừng. */
export function dungDongHoLeoThang(k: KetQuaLienHe | null): boolean {
  return k === "PH_DA_PHAN_HOI";
}

/**
 * Đã leo thang chưa (chống lặp mỗi sáng)? `lanLeoThangCuoi` = lần ESCALATE gần nhất.
 *
 * Mốc "đặt lại" chỉ là lần liên hệ mà phụ huynh PHẢN HỒI: nếu cho lần "không liên lạc được" cũng đặt lại mốc, thì mỗi cuộc gọi hụt SAU một lần
 * leo thang lại mở khoá leo thang thêm một lượt vào sáng hôm sau — tức nhân viên có thể "kích" cron bằng cách ghi liên hệ.
 */
export function daLeoThangSauLienHe(p: {
  lanLeoThangCuoi: Date | null;
  lastContactAt: Date | null;
  ketQuaLienHeCuoi: KetQuaLienHe | null;
}): boolean {
  if (p.lanLeoThangCuoi === null) return false;
  const moc = dungDongHoLeoThang(p.ketQuaLienHeCuoi) ? p.lastContactAt : null;
  return moc === null || p.lanLeoThangCuoi.getTime() > moc.getTime();
}
