// Một bé học thử NHIỀU lớp trial (chủ dự án chốt 04/11/2026).
//
// ~~Mỗi bé đúng MỘT lớp trial ACTIVE (partial-unique `TrialEnrollment_leadChildId_active_key`).~~
// **[ĐẢO 04/11/2026]** Một bé có thể ở nhiều lớp trial cùng lúc — nhưng KHÔNG ai cũng được thêm:
//   · Sale / Đào tạo: chỉ thêm bé CHƯA ở lớp trial ACTIVE nào (hành vi cũ, không đổi);
//   · Quản lý cơ sở (`trials:enroll-multi`): thêm bé vào lớp thứ hai trở đi, nhưng phải là
//     KHOÁ HỌC CHƯA TRIAL — buổi 1 trial Sata 3 thì buổi 2 phải khoá khác, không trial hai
//     buổi cùng một khoá;
//   · Quản trị tối cao (`trials:enroll-multi-any`): mở full, kể cả trial lại cùng khoá.
//
// Hai hàm dưới đây là LUẬT THUẦN. Mọi cửa đưa bé vào lớp / đổi khoá của một lượt trial phải hỏi
// ĐÚNG hai hàm này (luật cứng #1: không viết điều kiện quyền tại chỗ) — hai cửa theo hai luật là
// chỗ để lọt.

/** Một lượt trial KHÁC của cùng bé (không tính chính lượt đang xét). */
export type TrialKhacCuaBe = {
  status: "ACTIVE" | "COMPLETED" | "WITHDRAWN";
  /**
   * Khoá của lượt trial đó, chụp lúc xếp/đổi khoá. `null` = chưa biết (dữ liệu trước 04/11 hoặc
   * bé chưa có khoá). `null` KHÔNG bao giờ được coi là "trùng khoá" — không đoán.
   */
  courseId: string | null;
};

export type KetQuaCong = { duoc: true } | { duoc: false; lyDo: string };

/**
 * Bé đang ACTIVE ở `soLopDangO` lớp trial KHÁC lớp này — người này có được thêm bé vào lớp
 * này không?
 *
 * Bé chưa ở lớp nào khác ⇒ luôn được (đường cũ, không cần quyền mới).
 */
export function kiemThemLopTrialThuHai(p: {
  soLopDangO: number;
  coQuyenNhieuLop: boolean;
}): KetQuaCong {
  if (p.soLopDangO <= 0) return { duoc: true };
  if (p.coQuyenNhieuLop) return { duoc: true };
  return {
    duoc: false,
    lyDo: "Bé đang học thử ở một lớp trial khác — chỉ Quản lý cơ sở hoặc Quản trị viên thêm được bé vào lớp thứ hai",
  };
}

/**
 * Gán khoá `khoaMoi` cho một lượt trial của bé — có trùng khoá một lượt trial khác không?
 *
 * Chỉ lượt `ACTIVE` / `COMPLETED` tính là "đã trial khoá đó"; lượt `WITHDRAWN` (bé rút / bị gỡ) thì
 * không — bé chưa học thật. Người có `coQuyenMoRong` (Quản trị tối cao) được trial lại cùng khoá.
 */
export function kiemKhoaTrialMoi(p: {
  khoaMoi: string;
  trialKhac: readonly TrialKhacCuaBe[];
  coQuyenMoRong: boolean;
}): KetQuaCong {
  if (p.coQuyenMoRong) return { duoc: true };
  const trung = p.trialKhac.some(
    (t) => t.status !== "WITHDRAWN" && t.courseId !== null && t.courseId === p.khoaMoi,
  );
  if (!trung) return { duoc: true };
  return {
    duoc: false,
    lyDo: "Bé đã trial khoá này ở một lớp khác — chọn khoá chưa trial (chỉ Quản trị viên mới được trial lại cùng khoá)",
  };
}

/**
 * Xếp một lượt trial vào CASE: khoá của lượt đó là gì?
 *
 * Bé chỉ có MỘT lượt trial thì khoá = khoá quan tâm hiện tại của bé (đường cũ). Bé có lượt trial
 * KHÁC thì khoá quan tâm của bé có thể vẫn là khoá của lượt TRƯỚC (nó đổi theo từng lần thêm lớp),
 * nên đọc nó ở đây là gán nhầm khoá cũ cho lượt mới — phải đòi khoá ĐÃ CHỌN riêng cho lượt này.
 */
export function khoaChoLuotXepCase(p: {
  khoaCuaLuot: string | null;
  khoaHieuLucCuaBe: string | null;
  coLuotKhac: boolean;
}): { duoc: true; courseId: string | null } | { duoc: false; lyDo: string } {
  if (p.khoaCuaLuot) return { duoc: true, courseId: p.khoaCuaLuot };
  if (p.coLuotKhac) {
    return {
      duoc: false,
      lyDo: "Bé đang trial nhiều lớp — chọn khoá học riêng cho lượt này (ô “Khoá học”) rồi mới xếp vào case",
    };
  }
  return { duoc: true, courseId: p.khoaHieuLucCuaBe };
}
