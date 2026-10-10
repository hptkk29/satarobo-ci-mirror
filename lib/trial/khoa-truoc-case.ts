// KHOÁ HỌC CỦA BÉ TRONG LỚP TRIAL — hàm THUẦN (không DB), dùng chung server + client.
//
// ── CHỐT 26/09/2026 (chủ dự án) ──────────────────────────────────────────────────────
// Lớp trial CŨ có ô chọn khoá học cho cả lớp (`TrialClassV2.courseId`). Lớp trial MỚI
// (theo khung giờ) thì KHÔNG — một khung giờ nhận bé của nhiều khoá. Hệ quả đo được: cột
// "Khoá học" trên site giáo viên in "—", giáo viên vào lớp không biết bé học thử khoá gì.
//
// Luật: khoá của bé trong lớp mới = **khoá quan tâm của bé** (`LeadChild.interestedCourseId`
// — đúng ô Sale nhập ở khối Con trên màn lead, và là cột site GV vốn đã đọc). Bé chưa có
// khoá thì phải CHỌN ở khối "Chưa xếp case" trước khi được xếp vào case — chủ dự án:
// "thêm ô chọn khoá học ở chỗ chưa xếp case, để chọn khoá học trước khi thêm vào case".
//
// Cổng này CHỈ áp cho lớp theo khung: lớp cũ đã có khoá của lớp, chặn ở đó là bắt người
// dùng khai lại một thứ hệ thống đã biết.

export const LY_DO_CHUA_CHON_KHOA =
  "Chọn khoá học cho bé trước — giáo viên cần biết bé học thử khoá nào.";

export type KetQuaKhoaTruocCase = { duoc: true } | { duoc: false; lyDo: string };

/** Bé có được đưa vào một CASE của lớp này chưa, xét riêng về khoá học. */
export function kiemKhoaTruocKhiVaoCase(o: {
  /** `laLopTheoKhung(lop)` — lớp mới theo khung giờ. */
  lopTheoKhung: boolean;
  /** Khoá quan tâm của bé (`LeadChild.interestedCourseId`). */
  khoaCuaBe: string | null | undefined;
}): KetQuaKhoaTruocCase {
  if (!o.lopTheoKhung) return { duoc: true };
  const k = typeof o.khoaCuaBe === "string" ? o.khoaCuaBe.trim() : "";
  return k ? { duoc: true } : { duoc: false, lyDo: LY_DO_CHUA_CHON_KHOA };
}
