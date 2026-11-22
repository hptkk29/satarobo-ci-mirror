// lib/hoc-bu/duyet-case-thuan.ts — CASE DẠY BÙ CHỜ DUYỆT (20/10/2026). THUẦN, không chạm DB.
//
// Chủ dự án chốt 20/10/2026: case bù do Sale tạo ở trạng thái "chờ duyệt"; quản lý cơ sở duyệt thì MỚI thành lịch thật và giáo viên MỚI thấy.
//
// Một case chờ duyệt (`PENDING_APPROVAL`) GIỮ CHỖ — lượt của bé, giáo viên, phòng, khung giờ (lõi trùng lịch đọc cả nó) — nhưng CHƯA là lịch thật:
// giáo viên không thấy, không điểm danh được, không nhận tin, không có công dạy, không sinh phân công parttime, phụ huynh chưa được báo.
//
// ⚠️ Vì sao một hàm lọc dùng chung: thêm một giá trị vào enum KHÔNG làm `tsc` đỏ ở mọi chỗ đọc. Chỗ lọc `status: "SCHEDULED"` tự khép kín (không thấy
// trạng thái mới), nhưng chỗ lọc `not CANCELLED` hay KHÔNG lọc status thì thấy case chờ duyệt như một lịch thật. Mọi chỗ ĐỌC case để đưa cho giáo viên /
// công / phân công dùng `CASE_KHONG_PHAI_LICH_THAT` — và lưới `[DCW-*]` quét cả cây mã nguồn để một chỗ đọc mới không lọt.
import type { MakeupCaseStatus } from "@prisma/client";
import { gioCase } from "@/lib/hoc-bu/thong-bao-thuan";

export const CASE_CHO_DUYET = "PENDING_APPROVAL" as const satisfies MakeupCaseStatus;

/**
 * Người tạo case CÓ quyền duyệt (`makeup:waive` — quản lý cơ sở / quản trị) ⇒ case thành lịch thật ngay (tự duyệt không có nghĩa ở đây: họ chính là người
 * duyệt). Không có quyền (Sale, giáo vụ, quản lý lớp…) ⇒ CHỜ DUYỆT. MỘT chỗ quyết — `coQuyenDuyet` BẮT BUỘC khai ở chỗ gọi (không mặc định: mặc định sai
 * là hoặc chặn mọi case của quản lý, hoặc cho Sale bỏ qua bước duyệt).
 */
export function trangThaiCaseKhiTao(p: { coQuyenDuyet: boolean }): "SCHEDULED" | "PENDING_APPROVAL" {
  return p.coQuyenDuyet ? "SCHEDULED" : CASE_CHO_DUYET;
}

/** Trạng thái KHÔNG phải một buổi dạy bù thật: đã huỷ, hoặc chưa được duyệt. Dùng cho mọi `status: { notIn: [...] }` đưa case cho giáo viên / công / phân công. */
export const CASE_KHONG_PHAI_LICH_THAT: readonly MakeupCaseStatus[] = ["CANCELLED", CASE_CHO_DUYET];

/** Case còn "sống" (chưa chốt, chưa huỷ): đã duyệt đang chờ dạy, hoặc đang chờ duyệt. Bé của case sống đang giữ lượt. */
export const laCaseSong = (s: MakeupCaseStatus): boolean => s === "SCHEDULED" || s === CASE_CHO_DUYET;

export type KetQuaKiemDuyet = { ok: true } | { ok: false; lyDo: string };

/**
 * Duyệt được không: phải đang chờ duyệt, và buổi bù CHƯA qua giờ kết thúc (duyệt một buổi đã trôi qua là tạo ra lịch thật trong quá khứ mà giáo viên không
 * còn dạy được — người duyệt phải từ chối để các bé quay lại danh sách cần bù).
 */
export function kiemDuyetDuoc(p: { status: MakeupCaseStatus; ymd: string; startTime: string; endTime: string; now: Date }): KetQuaKiemDuyet {
  if (p.status !== CASE_CHO_DUYET) return { ok: false, lyDo: "Case này không ở trạng thái chờ duyệt — tải lại trang" };
  const { ketThuc } = gioCase({ ymd: p.ymd, startTime: p.startTime, endTime: p.endTime });
  if (p.now.getTime() >= ketThuc.getTime()) return { ok: false, lyDo: "Buổi bù này đã qua giờ — hãy từ chối để các bé quay lại danh sách cần bù" };
  return { ok: true };
}
