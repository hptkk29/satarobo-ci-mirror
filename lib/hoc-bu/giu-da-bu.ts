// lib/hoc-bu/giu-da-bu.ts — LUẬT GIỮ "ĐÃ HỌC BÙ" khi LƯU điểm danh (T02, 07/10/2026). THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY (HB-05, HB-40 — CRITICAL):
// `Attendance.makeupStatus = MADE_UP` là dấu "buổi vắng này đã học bù xong". Nó do MODULE HỌC BÙ đặt
// (`diemDanhBu`), nhưng BỐN đường lưu điểm danh khác đều tự tính lại `makeupStatus` từ payload rồi
// ghi thẳng vào nhánh `update`:
//   · site GV     `saveClassAttendanceAction`        — panel chỉ gửi {studentId, status, note}
//   · admin       `markAttendance`                   — lưới gửi lại giá trị nó đã tải về (có thể CŨ)
//   · phiếu nghỉ  `resolveAbsence`                   — `upsert` không đọc giá trị cũ
//   · dịch vụ     `recordAttendance`                 — `willMakeup ? NEEDS_MAKEUP : NONE`
// Mỗi lần giáo viên mở buổi cũ bấm Lưu là cả lớp mất dấu đã bù: học viên hiện lại ở /admin/hoc-bu như
// chưa bù, % chuyên cần sai, và nếu tạo phí thì phụ huynh bị đòi tiền một buổi đã học.
//
// LUẬT: MADE_UP chỉ do module học bù đặt và gỡ. Mọi đường LƯU ĐIỂM DANH đều KHÔNG được hạ nó — kể cả khi
// học viên nay được ghi "có mặt" (dữ liệu cũ bị ghi đè PRESENT, xem TV-20) và kể cả khi client gửi tường
// minh một giá trị khác (tab cũ mở trước lúc bù xong). Muốn hoàn tác một buổi bù là việc RIÊNG có audit
// (T08), không đi qua lưới điểm danh.
// ─────────────────────────────────────────────────────────────────────────────
export type MakeupStatusDiemDanh = "NONE" | "NEEDS_MAKEUP" | "MADE_UP";

/** Có mặt (PRESENT/LATE) = không nợ buổi; mọi trạng thái khác là vắng. */
export const laVangDiemDanh = (status: string): boolean => status !== "PRESENT" && status !== "LATE";

type Vao = {
  /** Trạng thái điểm danh MỚI của học viên. */
  status: string;
  /** `makeupStatus` HIỆN CÓ trong DB. `undefined` = chưa có bản ghi điểm danh. */
  cu: MakeupStatusDiemDanh | undefined;
  /** Giá trị client gửi TƯỜNG MINH. `undefined` = client không nói gì (panel GV không gửi). */
  guiLen: MakeupStatusDiemDanh | undefined;
};

/**
 * `makeupStatus` SAU khi lưu điểm danh một học viên.
 *   1. Đã MADE_UP ⇒ giữ MADE_UP (xem đầu file).
 *   2. Có mặt ⇒ NONE (đi học thì không có gì để bù).
 *   3. Vắng ⇒ "cần bù" — kể cả vắng có phép (chốt 02/10/2026); chỉ client tường minh gửi MADE_UP
 *      (nhân viên chọn "Đã học bù" ở lưới admin cho buổi bù ngoài hệ thống) mới đặt được MADE_UP.
 */
export function makeupStatusSauKhiLuu({ status, cu, guiLen }: Vao): MakeupStatusDiemDanh {
  if (cu === "MADE_UP") return "MADE_UP";
  if (!laVangDiemDanh(status)) return "NONE";
  return guiLen === "MADE_UP" ? "MADE_UP" : "NEEDS_MAKEUP";
}

/**
 * Client ĐÒI hạ một buổi vắng đã MADE_UP (gửi NEEDS_MAKEUP / NONE tường minh). Một lưới điểm danh mở từ trước
 * lúc bù xong gửi đúng như vậy — nên đường có giá trị tường minh (admin) phải TỪ CHỐI cả lô và bảo tải lại,
 * thay vì lặng lẽ bỏ qua: bỏ qua lặng lẽ là nút nói dối (luật 12), còn nghe theo là mất dấu đã bù (HB-40).
 */
export function doiHaDaBu({ status, cu, guiLen }: Vao): boolean {
  return cu === "MADE_UP" && laVangDiemDanh(status) && guiLen !== undefined && guiLen !== "MADE_UP";
}
