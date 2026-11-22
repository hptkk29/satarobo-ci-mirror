// lib/trial/ket-cuc-case.ts — case trial KẾT THÚC thế nào: HOÀN TẤT hay TỰ HUỶ. THUẦN (không DB) — mọi chỗ gọi hỏi ở đây.
//
// Chủ dự án chốt 21/10/2026: case không bé nào CÓ MẶT (vắng hết, hoặc bé đã được dời sang case khác nên case trống) thì hệ
// thống HUỶ case, giáo viên KHÔNG có công. Trước đó "Hoàn tất buổi" không đọc điểm danh ⇒ case toàn vắng thành COMPLETED, được
// tính công dạy cũ (`loadBuoiDay` chỉ lọc COMPLETED) và Parttime cắm cờ "Buổi đã chốt mà không có giáo viên đứng chính đã nhận".
// Đo prod 21/10: 14/58 case COMPLETED không có dòng PRESENT nào.
//
// Khác học bù (`chotCase`: toàn vắng ⇒ NO_SHOW, GV VẪN có công) — có chủ đích: trial không có trạng thái NO_SHOW, và chủ dự án
// chọn "tự huỷ, GV không công" thay cho "huỷ nhưng GV vẫn có công".

//
// 22/10/2026 — "case trống thì tự huỷ" áp cho MỌI đường làm bé rời case, không chỉ dời: gỡ khỏi case (`goHocVienKhoiCase`), rút
// khỏi lớp (`unenrollLeadChild`), dời case (`rescheduleTrialEnrollment`). Ba đường cùng gọi MỘT phép kiểm DB
// (`huyCaseNeuTrong`, lib/trial/huy-case-trong-db.ts), phép đó hỏi `canHuyCaseTrong` ở đây — không đường nào tự viết công thức.

/** Lý do in vào lịch sử lead + tin báo giáo viên. Cố định để đếm được trong báo cáo. */
export const LY_DO_HUY_KHONG_AI_CO_MAT = "Tự huỷ: không học viên nào có mặt";
export const LY_DO_HUY_CASE_TRONG = "Tự huỷ: học viên đã dời sang case khác, case không còn ai";
export const LY_DO_HUY_CASE_DA_GO = "Tự huỷ: học viên đã được gỡ khỏi case, case không còn ai";
export const LY_DO_HUY_CASE_DA_RUT = "Tự huỷ: học viên đã rút khỏi lớp, case không còn ai";

export const LY_DO_HUY_CASE_TRONG_QUA_HAN = "Tự huỷ: case đã qua giờ mà không có học viên nào";

/** Việc vừa làm bé rời case — chỉ để chọn lý do; LUẬT huỷ giống hệt nhau. */
export type ViecRoiCase = "DOI" | "GO" | "RUT";
const LY_DO_THEO_VIEC: Record<ViecRoiCase, string> = { DOI: LY_DO_HUY_CASE_TRONG, GO: LY_DO_HUY_CASE_DA_GO, RUT: LY_DO_HUY_CASE_DA_RUT };

/**
 * Ghi danh nào còn là "bé của case": ACTIVE (đang học thử) và COMPLETED (`syncTrialProgress` đóng khi bé đã dự đủ buổi — bé đã
 * học thật, không phải đã rời). WITHDRAWN (rút khỏi lớp / huỷ lớp) thì không. MỘT định nghĩa — câu đếm DB dùng đúng hằng này.
 */
export const TRANG_THAI_GHI_DANH_HIEU_LUC = ["ACTIVE", "COMPLETED"] as const;
export function laGhiDanhHieuLuc(status: string): boolean {
  return (TRANG_THAI_GHI_DANH_HIEU_LUC as readonly string[]).includes(status);
}

export type KetCucHoanTat = { loai: "HOAN_TAT" } | { loai: "HUY"; lyDo: string };

/** Bấm "Hoàn tất buổi": có ≥1 bé có mặt ⇒ hoàn tất; không ai ⇒ huỷ. Đếm bản ghi điểm danh PRESENT CỦA CHÍNH CASE NÀY. */
export function ketCucKhiHoanTat(p: { soCoMat: number }): KetCucHoanTat {
  return p.soCoMat > 0 ? { loai: "HOAN_TAT" } : { loai: "HUY", lyDo: LY_DO_HUY_KHONG_AI_CO_MAT };
}

/**
 * Sau khi một bé RỜI case (dời · gỡ · rút): case đó còn sống không.
 *
 * - Chỉ lớp THEO KHUNG — ở lớp slot cũ `scheduledSessionId = NULL` nghĩa là "học cả lớp" (`lib/trial/nghia-null.ts`), nên đếm
 *   bé đang trỏ vào case sẽ gọi nhầm mọi buổi là "trống".
 * - Còn ≥1 bé hiệu lực (`TRANG_THAI_GHI_DANH_HIEU_LUC`) ⇒ giữ. Đã có ≥1 bé CÓ MẶT ⇒ giữ (đã dạy thật). "Chưa điểm danh" KHÔNG bị
 *   coi là vắng — luật chỉ chạy khi case KHÔNG CÒN AI, nên không có ai để suy vắng.
 * - Case đã HOÀN TẤT mà kỳ công tháng của nó ĐÃ CHỐT ⇒ giữ: huỷ lúc đó là rút công dạy đã chốt (cùng cổng với lệnh dọn
 *   `scripts/trial-huy-case-vang-het.ts`). Case chưa diễn ra không mang công, huỷ được bất kể kỳ.
 * - Case đã huỷ ⇒ thôi (gọi lại không đổi gì).
 */
export function canHuyCaseTrong(p: {
  lopTheoKhung: boolean;
  trangThaiCase: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  soBeHieuLuc: number;
  soCoMat: number;
  /** Kỳ công (tháng của case × cơ sở) đã LOCKED. BẮT BUỘC — để `tsc` liệt kê mọi chỗ gọi. */
  kyDaChot: boolean;
  viec: ViecRoiCase;
}): { huy: false } | { huy: true; lyDo: string } {
  if (!p.lopTheoKhung) return { huy: false };
  if (p.trangThaiCase === "CANCELLED") return { huy: false };
  if (p.soBeHieuLuc > 0 || p.soCoMat > 0) return { huy: false };
  if (p.trangThaiCase === "COMPLETED" && p.kyDaChot) return { huy: false };
  return { huy: true, lyDo: LY_DO_THEO_VIEC[p.viec] };
}

/**
 * STALE_EMPTY_CASE (22/10/2026): case đã QUA GIỜ kết thúc mà vẫn SCHEDULED, không có bé hiệu lực nào, KHÔNG có dòng điểm danh
 * nào (kể cả vắng), kỳ công chưa chốt ⇒ case rỗng bị bỏ quên — huỷ được. Khác `canHuyCaseTrong` (chạy lúc một bé RỜI case):
 * case loại này thường chưa từng có bé, nên không có thao tác nào kích luật kia. Lệnh dọn theo tháng
 * (`scripts/trial-huy-case-vang-het.ts --loai=trong-qua-han`) hỏi hàm này — không đoán "chưa điểm danh = vắng": chỉ case
 * KHÔNG CÒN AI mới vào.
 */
export function laCaseTrongQuaHan(p: {
  lopTheoKhung: boolean;
  trangThaiCase: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  daQuaGio: boolean;
  soBeHieuLuc: number;
  soDongDiemDanh: number;
  kyDaChot: boolean;
}): boolean {
  return (
    p.lopTheoKhung &&
    p.trangThaiCase === "SCHEDULED" &&
    p.daQuaGio &&
    p.soBeHieuLuc === 0 &&
    p.soDongDiemDanh === 0 &&
    !p.kyDaChot
  );
}
