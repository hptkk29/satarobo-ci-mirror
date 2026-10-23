// lib/parttime/cong-viec-hop-le.ts — MỘT định nghĩa (thuần) cho câu "hôm nay người này có VIỆC HỢP LỆ ở cơ sở này không"
// (H1 · SR.QD.238). Cờ `CHAM_NGOAI_LICH` ("hôm nay bạn không có ca") chỉ được gắn khi câu trả lời là KHÔNG.
//
// VÌ SAO: luật cũ chỉ hỏi ô ca (`ShiftAssignment`). Với mô hình Parttime, nghĩa vụ làm việc còn có thể là
//   B. phân công dạy / trợ giảng (`SessionStaffAssignment` MAIN_TEACHER · TEACHING_ASSISTANT) ĐÃ NHẬN đúng phiên bản hiện tại;
//   C. dòng trực vận hành tường minh (`OperationsDutyAssignment`) ĐÃ NHẬN đúng phiên bản hiện tại.
// GV chỉ có tiết 18:00 (không ô ca) bấm 17:47 mà bị gắn "hôm nay bạn không có ca" là sai đúng lượt quan trọng nhất của ngày.
//
// CHẶT HƠN cổng hướng (`laNgayParttime`): cổng hướng đếm cả phân công CHỜ nhận (để hướng theo hiện diện ngay từ lúc được giao),
// còn ở đây CHỈ việc đã nhận mới là "có lịch". Tiết chưa nhận ⇒ hướng theo hiện diện NHƯNG vẫn gắn cờ — có chủ đích: chưa nhận
// lớp thì chưa phải nghĩa vụ; thẻ đã nói "chưa xác nhận nhận lớp".
//
// THEO CƠ SỞ: việc ở CS1 KHÔNG làm lượt quét ở CS2 thành "có lịch". Ca thường giữ luật cũ (mọi cơ sở — nơi sai do `SAI_NOI_LAM`
// lo), để nhân viên chỉ có ca thường không đổi một chữ.
import type { BangChungPhanCong } from "./bang-chung-cong";

/** Tiết là việc CỦA HÔM NAY (đã có khung SR.QD.238, buổi không huỷ / không đóng) — chưa xét đã nhận. Màn ngữ cảnh dùng đúng lọc này. */
export function tietLaViecHomNay(r: Pick<BangChungPhanCong, "requiredFrom" | "requiredTo" | "trangThai" | "dongDoi">): boolean {
  return r.requiredFrom != null && r.requiredTo != null && r.dongDoi.tinhTrangBuoi !== "DA_DONG" && r.trangThai !== "BUOI_DA_HUY";
}

/**
 * Tiết HỢP LỆ = việc của hôm nay + ĐÃ NHẬN đúng phiên bản hiện tại (DECLINED / REPLACED đã bị loại ở câu đọc P4) — hoặc nhập
 * cutover còn trong grace (Q5, `graceCutover`: chỉ phân công CUTOVER chờ xác nhận, trước mốc grace của cơ sở). Phân công THƯỜNG
 * chưa nhận vẫn KHÔNG hợp lệ (luật H1 giữ nguyên — lưới [GRACE-02]).
 */
export function tietHopLe(r: Pick<BangChungPhanCong, "requiredFrom" | "requiredTo" | "trangThai" | "dongDoi" | "daNhan" | "graceCutover">): boolean {
  return (r.daNhan || r.graceCutover) && tietLaViecHomNay(r);
}

const TRUC_SONG = new Set(["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"]);

/** Trực HỢP LỆ = dòng còn sống + có xác nhận NHẬN đúng phiên bản hiện tại (đổi giờ / đổi người ⇒ phiên bản mới ⇒ phải nhận lại). */
export function trucHopLe(t: { status: string; assignmentVersion: number; acceptances: readonly { assignmentVersion: number; decision: string }[] }): boolean {
  return TRUC_SONG.has(t.status) && t.acceptances.some((a) => a.assignmentVersion === t.assignmentVersion && a.decision === "ACCEPTED");
}

/**
 * `coCongViecHopLeHomNay` — lõi thuần. `caThuong` = có `ShiftAssignment` ACTIVE hôm nay (mọi cơ sở, luật cũ). `coSoParttime` = tập
 * cơ sở có ít nhất một tiết / ca trực HỢP LỆ hôm nay (rỗng khi công tắc tắt / ngày LEGACY).
 */
export function coCongViecHopLeHomNay(p: { caThuong: boolean; coSoParttime: ReadonlySet<string>; centerId: string }): boolean {
  return p.caThuong || p.coSoParttime.has(p.centerId);
}
