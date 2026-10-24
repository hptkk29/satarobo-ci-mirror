// lib/cham-cong/flag-labels.ts — nhãn tiếng Việt của cờ hậu kiểm (StaffAttendanceDay.flags).
//
// Vì sao file này tồn tại: bảng nhãn nằm trong `app/(admin)/admin/cham-cong/page.tsx` nên
// mọi nơi khác (chip cờ dùng chung với site GV, Sheet chi tiết ngày, đối soát, kỳ công)
// hoặc in mã trần `THIEU_LUOT_RA`, hoặc chép lại bảng. Hoist ra đây để có ĐÚNG MỘT bản.
//
// THUẦN — không DB, không React. Mã cờ do `lib/cham-cong/engine.ts` + `timelog.ts` sinh.
export type FlagTone = "warn" | "danger" | "info";
export type FlagInfo = { text: string; tone: FlagTone };

/** Nguyên văn từ bảng cũ ở `cham-cong/page.tsx` — đủ mọi mã hai file engine sinh ra. */
export const FLAG_LABEL: Record<string, FlagInfo> = {
  KHONG_CO_LUOT: { text: "Không có lượt", tone: "danger" },
  THIEU_LUOT_RA: { text: "Thiếu lượt ra", tone: "warn" },
  RA_KHONG_CO_VAO: { text: "Ra không có vào", tone: "warn" },
  THIEU_BUOI_SANG: { text: "Thiếu buổi sáng", tone: "warn" },
  THIEU_BUOI_CHIEU: { text: "Thiếu buổi chiều", tone: "warn" },
  THIEU_LUOT_GIUA_CA: { text: "Thiếu lượt giữa ca", tone: "warn" },
  DI_MUON: { text: "Đi muộn", tone: "warn" },
  VE_SOM: { text: "Về sớm", tone: "warn" },
  // Muộn/sớm TRONG khung đơn đã duyệt (đợt 2 đơn từ, Q-5 "miễn trừ") — chỉ ghi chú, không cần rà.
  DI_MUON_DA_DUYET: { text: "Đi muộn — đã được duyệt", tone: "info" },
  VE_SOM_DA_DUYET: { text: "Về sớm — đã được duyệt", tone: "info" },
  // Đợt 4 — ngày có khung tăng ca đã duyệt (số phút ở cột OT).
  TANG_CA_DUYET: { text: "Tăng ca đã duyệt", tone: "info" },
  // Đợt 5–6 — ngày / lượt theo đơn làm từ xa · công tác đã duyệt (thông tin, không phải vi phạm).
  LAM_TU_XA_DUYET: { text: "Làm từ xa — Đã duyệt", tone: "info" },
  CONG_TAC_DUYET: { text: "Đi công tác — Đã duyệt", tone: "info" },
  CONG_TAC_DU_CONG: { text: "Công tác: đủ công theo ca", tone: "info" },
  LAM_TU_XA: { text: "Quét khi làm từ xa", tone: "info" },
  CONG_TAC: { text: "Quét khi đi công tác", tone: "info" },
  // Đợt 7–8 — nghỉ một phần ca / nghỉ bù đã duyệt; nửa buổi trên ca không chia buổi ⇒ không áp được.
  NGHI_MOT_PHAN_DUYET: { text: "Nghỉ một phần ca — Đã duyệt", tone: "info" },
  NGHI_BU_DUYET: { text: "Nghỉ bù — Đã duyệt", tone: "info" },
  NGHI_KHONG_AP_DUOC: { text: "Đơn nghỉ không áp được vào ca", tone: "warn" },
  // Đợt 9–10 — làm ngày nghỉ / lễ theo đơn; lượt quét trong khung chấm ngoài địa điểm đã duyệt.
  LAM_NGAY_NGHI_DUYET: { text: "Làm ngày nghỉ / lễ — Đã duyệt", tone: "info" },
  NGOAI_DIA_DIEM_DUYET: { text: "Quét ngoài địa điểm (đã duyệt)", tone: "info" },
  // Tính lại công muốn trừ quỹ nghỉ bù đã được dùng — không trừ để quỹ không âm, quản lý phải rà soát.
  QUY_NGHI_BU_CAN_RA_SOAT: { text: "Quỹ nghỉ bù cần rà soát", tone: "warn" },
  THIEU_GIO: { text: "Thiếu giờ", tone: "warn" },
  DEN_SAT_GIO: { text: "Đến sát giờ", tone: "info" },
  NGOAI_VUNG: { text: "Ngoài vùng", tone: "danger" },
  THIEU_GPS: { text: "Thiếu GPS", tone: "info" },
  CHUA_TOA_DO: { text: "Chưa toạ độ", tone: "info" },
  SAI_NOI_LAM: { text: "Sai nơi làm", tone: "danger" },
  CHAM_NGOAI_LICH: { text: "Chấm ngoài lịch", tone: "warn" },
  TRUNG_2_PHUT: { text: "Bấm trùng", tone: "info" },
  VUOT_TRAN: { text: "Vượt trần lượt", tone: "warn" },
  LAM_NGAY_LE: { text: "Làm ngày lễ", tone: "info" },
  GPS_KEM_CHINH_XAC: { text: "GPS kém", tone: "info" },
  CHINH_TAY: { text: "Chỉnh tay (đơn duyệt)", tone: "info" },
};

/**
 * Nhãn của một mã cờ. Mã lạ (engine thêm cờ mới mà chưa cập nhật bảng trên) ⇒ in NGUYÊN
 * mã với tông `info` để nó không nhuộm đỏ cả bảng — nhưng nó VẪN được đếm là việc cần rà,
 * xem `countsAsIssue`.
 */
export function flagInfo(code: string): FlagInfo {
  return FLAG_LABEL[code] ?? { text: code, tone: "info" };
}

/**
 * Cờ này có tính là "cần rà" không (đếm KPI, xếp dòng lên đầu)? `info` đã khai = chỉ ghi chú.
 *
 * ⚠️ MÃ LẠ TÍNH LÀ CẦN RÀ — đúng hành vi của bảng cũ (`FLAG_LABEL[f]?.tone !== "info"`), và
 * là chủ đích: engine thêm một cờ mới mà quên khai nhãn ở đây thì nó phải LỘ RA trên KPI để
 * có người hỏi, chứ không được im lặng rơi khỏi hàng chờ. Đúng loại lỗi im lặng đã burn repo
 * này nhiều lần (cron 401, webhook 401). Muốn một cờ mới chỉ là ghi chú thì khai nó `info`.
 */
export function countsAsIssue(code: string): boolean {
  const known = FLAG_LABEL[code];
  return known ? known.tone !== "info" : true;
}
