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
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";

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
  /**
   * Trạng thái điểm danh TRƯỚC lần lưu (`undefined` = chưa có bản ghi, hoặc nơi gọi KHÔNG muốn giữ lựa chọn "Không cần bù" cũ — vd. phiếu xin học bù của phụ huynh).
   * Chỉ dùng để GIỮ lựa chọn "Không cần bù": bản ghi cũ vắng + `NONE` + client không nói gì (panel GV không gửi `makeupStatus`) ⇒ vẫn `NONE`.
   */
  statusCu?: string;
  /** Nhân viên chọn TƯỜNG MINH "Không cần bù" cho buổi vắng này (nút ở lưới admin). Không có cờ này thì `NONE` gửi lên cho buổi vắng vẫn bị coi là "cần bù". */
  khongCanBu?: boolean;
};

/**
 * `makeupStatus` SAU khi lưu điểm danh một học viên.
 *   1. Đã MADE_UP ⇒ giữ MADE_UP (xem đầu file).
 *   2. Có mặt ⇒ NONE (đi học thì không có gì để bù).
 *   3. Vắng ⇒ "cần bù" — kể cả vắng có phép (chốt 02/10/2026); chỉ client tường minh gửi MADE_UP
 *      (nhân viên chọn "Đã học bù" ở lưới admin cho buổi bù ngoài hệ thống) mới đặt được MADE_UP.
 *   4. [22/10/2026 — chủ dự án đảo một phần chốt 02/10] Vắng + nhân viên chọn TƯỜNG MINH "Không cần bù" (`khongCanBu`) ⇒ NONE: không tạo dòng cần bù.
 *      Lựa chọn đó được GIỮ khi nơi khác lưu lại điểm danh mà không nói gì (`guiLen` trống, bản ghi cũ vắng + NONE): nếu không, giáo viên mở lại buổi
 *      bấm Lưu là buổi vắng tự "cần bù" trở lại. Mặc định (không cờ, không `statusCu`) vẫn y như cũ — `NONE` gửi lên cho buổi vắng là "cần bù".
 */
export function makeupStatusSauKhiLuu({ status, cu, guiLen, statusCu, khongCanBu }: Vao): MakeupStatusDiemDanh {
  if (cu === "MADE_UP") return "MADE_UP";
  if (!laVangDiemDanh(status)) return "NONE";
  if (guiLen === "MADE_UP") return "MADE_UP";
  if (khongCanBu === true) return "NONE";
  if (guiLen === undefined && cu === "NONE" && statusCu !== undefined && laVangDiemDanh(statusCu)) return "NONE";
  return "NEEDS_MAKEUP";
}

/**
 * Client ĐÒI hạ một buổi vắng đã MADE_UP (gửi NEEDS_MAKEUP / NONE tường minh). Một lưới điểm danh mở từ trước
 * lúc bù xong gửi đúng như vậy — nên đường có giá trị tường minh (admin) phải TỪ CHỐI cả lô và bảo tải lại,
 * thay vì lặng lẽ bỏ qua: bỏ qua lặng lẽ là nút nói dối (luật 12), còn nghe theo là mất dấu đã bù (HB-40).
 */
export function doiHaDaBu({ status, cu, guiLen }: Vao): boolean {
  return cu === "MADE_UP" && laVangDiemDanh(status) && guiLen !== undefined && guiLen !== "MADE_UP";
}

/**
 * Lần này là một lựa chọn "Không cần bù" MỚI? (22/10/2026 — chủ dự án siết: chỉ cấp quản lý cơ sở + bắt buộc lý do.)
 * `sau` là kết quả `makeupStatusSauKhiLuu`. Vắng + NONE mà bản ghi cũ ĐÃ là NONE nghĩa là lựa chọn đã có từ trước (lưới gửi lại giá trị nó đã tải, hoặc panel GV
 * giữ lại) — KHÔNG phải quyết định mới nên không đòi quyền / lý do lần nữa; nếu đòi, mọi lần sửa ghi chú của một buổi đã "không cần bù" đều bị chặn oan.
 */
export function laChonKhongCanBuMoi({ status, cu, sau }: { status: string; cu: MakeupStatusDiemDanh | undefined; sau: MakeupStatusDiemDanh }): boolean {
  return laVangDiemDanh(status) && sau === "NONE" && cu !== "NONE";
}

/** Câu từ chối lý do "Không cần bù", hoặc `null` nếu đủ. Cùng ngưỡng với "Huỷ không bù" ở /hoc-bu (`LY_DO_TOI_THIEU`) để người vận hành gặp một luật, không hai. */
export function kiemLyDoKhongCanBu(lyDo: string | null | undefined): string | null {
  return (lyDo ?? "").trim().length >= LY_DO_TOI_THIEU ? null : `Ghi lý do "Không cần bù" ít nhất ${LY_DO_TOI_THIEU} ký tự`;
}
