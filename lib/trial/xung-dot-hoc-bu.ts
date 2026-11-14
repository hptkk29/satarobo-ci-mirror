// lib/trial/xung-dot-hoc-bu.ts — buổi / case TRIAL phải THẤY case dạy bù (T09 + T09-F1, HB-28).
//
// Trước T09 chỉ có "note đỏ" chọn giáo viên (mềm, chốt V2-b của chủ dự án) và nó không biết `MakeupCase`. Ngoài note đó, đường ghi trial không hỏi ai
// về lịch. Hàm này là cổng CHẶN hẹp cho đúng hai thứ không thể đúng cùng lúc, qua CHÍNH lõi `checkScheduleConflicts` (không truy vấn riêng):
//   · PHÒNG — hai thứ không thể cùng dùng một phòng một giờ;
//   · HỌC VIÊN THẬT SỰ thuộc case trial (`nghia-null.ts`) mà đang có case dạy bù chồng giờ — bé không thể ở hai nơi.
// Giáo viên KHÔNG chặn ở đây: trùng GV của trial vẫn là cảnh báo mềm (note đỏ, nay đã thấy case dạy bù). Chỉ nhìn nguồn `MAKEUP_CASE`: lớp chính ↔
// trial là luật cũ chưa ai đổi.
import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import {
  checkScheduleConflicts,
  dungThongDiepXungDot,
  hocVienTuTre,
  layHocVienCuaBuoiTrial,
} from "@/lib/lms/schedule-conflict";

/** Học viên của phép kiểm: các học viên đang thuộc một buổi trial (xác định bằng ghi danh), hoặc các đứa trẻ sắp được xếp vào buổi. */
export type NguoiThamGiaTrial = { buoiTrialId: string } | { leadChildIds: readonly string[] } | null;

/**
 * Câu lỗi nếu khung (ngày VN + giờ) của buổi trial đè case dạy bù ở PHÒNG đã chọn hoặc ở HỌC VIÊN tham gia; null nếu không.
 * Đọc bằng `db` TRẦN cố ý: quyền xem KHÔNG được biến thành "không thấy ⇒ không bận". Câu nói ẩn tên nguồn ngoài tầm nhìn của `actor`.
 * Không có phòng và không có học viên xác định ⇒ không có gì để so (null, không tốn truy vấn lịch).
 */
export async function trialTrungHocBu(p: {
  actor: Actor;
  /** "YYYY-MM-DD" theo ngày VN. */
  ymd: string;
  startTime: string;
  endTime: string;
  roomId?: string | null;
  nguoiThamGia: NguoiThamGiaTrial;
}): Promise<string | null> {
  const studentIds = !p.nguoiThamGia
    ? []
    : "buoiTrialId" in p.nguoiThamGia
      ? await layHocVienCuaBuoiTrial(db, p.nguoiThamGia.buoiTrialId)
      : await hocVienTuTre(db, p.nguoiThamGia.leadChildIds);
  if (!p.roomId && studentIds.length === 0) return null;
  const kq = await checkScheduleConflicts({
    khung: { ymd: p.ymd, startTime: p.startTime, endTime: p.endTime },
    roomId: p.roomId,
    studentIds,
    nguon: ["MAKEUP_CASE"],
  });
  if (!kq.coXungDot) return null;
  return `Trùng lịch học bù — ${(await dungThongDiepXungDot(kq, { actor: p.actor })).join(" ")}`;
}
