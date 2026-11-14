// lib/parttime/don-vi-tiet.ts — Q1 · một buổi dạy quy bao nhiêu TIẾT. THUẦN, không DB, không đồng hồ.
//
// Chủ dự án (PARTTIME-CUTOVER §1, 18/10/2026): 1 tiết chuẩn = 10' chuẩn bị + 90' dạy = 100'. Buổi 90' ⇒ ứng viên tiết chuẩn.
// Buổi 60' / 120' (hay bất kỳ thời lượng nào khác) ⇒ NEEDS_POLICY_DECISION. KHÔNG BAO GIỜ tự quy đổi 60' → 0,6 hay 120' → 1,2
// (lưới M-Q1-01 / M-Q1-02). Đường DUY NHẤT để một buổi lệch chuẩn có số tiết là một dòng `TeachingUnitPolicyOverride` do chủ
// dự án duyệt — bảng phát hành RỖNG, chưa có màn / action ghi.
//
// Ghi đè CHỈ áp cho buổi LỆCH chuẩn: một ghi đè phạm vi lớp không được âm thầm đổi tiết 90' của lớp đó.
// Hai ghi đè cùng hạng ưu tiên cùng khớp ⇒ xung đột ⇒ NEEDS_POLICY_DECISION (không đoán dòng nào thắng).

export type PhamViGhiDe = "SESSION" | "CLASS" | "COURSE" | "SESSION_TYPE";
/** Hạng ưu tiên: hẹp thắng rộng. */
export const THU_TU_PHAM_VI: readonly PhamViGhiDe[] = ["SESSION", "CLASS", "COURSE", "SESSION_TYPE"];

export type GhiDeDonVi = {
  id: string;
  scopeType: PhamViGhiDe;
  scopeId: string;
  /** "YYYY-MM-DD" */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Thời lượng DẠY (phút) mà dòng này áp — null = mọi thời lượng lệch chuẩn của phạm vi. */
  teachingDurationMinutes: number | null;
  /** Số tiết, dạng thập phân "0.67" (Decimal(5,2)). */
  teachingUnits: string;
  policyVersionId: string;
};

/** Định danh của MỘT buổi theo bốn phạm vi (null = buổi không có chiều đó, vd học bù không có lớp). */
export type KhoaBuoi = { sessionId: string | null; classId: string | null; courseId: string | null; sessionType: string | null };

export type DonViTiet =
  | { trangThai: "CHUAN"; donVi: "1"; ghiDeId: null }
  | { trangThai: "GHI_DE"; donVi: string; ghiDeId: string }
  | { trangThai: "NEEDS_POLICY_DECISION"; donVi: null; ghiDeId: null; lyDo: "THOI_LUONG_LECH_CHUAN" | "GHI_DE_XUNG_DOT" };

const khopPhamVi = (g: GhiDeDonVi, k: KhoaBuoi): boolean =>
  (g.scopeType === "SESSION" && g.scopeId === k.sessionId) ||
  (g.scopeType === "CLASS" && g.scopeId === k.classId) ||
  (g.scopeType === "COURSE" && g.scopeId === k.courseId) ||
  (g.scopeType === "SESSION_TYPE" && g.scopeId === k.sessionType);

/** Các ghi đè CÓ THỂ áp cho buổi: đúng phạm vi + còn hiệu lực ngày `ymd` + đúng bản chính sách tại ngày đó. */
export function ghiDeChoBuoi(ds: readonly GhiDeDonVi[], k: KhoaBuoi, ymd: string, policyVersionId: string | null): GhiDeDonVi[] {
  if (!policyVersionId) return [];
  return ds.filter(
    (g) => g.policyVersionId === policyVersionId && g.effectiveFrom <= ymd && (g.effectiveTo == null || ymd <= g.effectiveTo) && khopPhamVi(g, k),
  );
}

/**
 * Số tiết của MỘT buổi. `ghiDe` = đã lọc bằng `ghiDeChoBuoi`. Buổi chuẩn ⇒ "1" bất kể ghi đè. Lệch chuẩn ⇒ ghi đè hẹp nhất có
 * thời lượng khớp (hoặc không khai thời lượng); không có ⇒ NEEDS_POLICY_DECISION.
 */
export function donViTiet(p: { thoiLuongDayPhut: number; chuanDayPhut: number; ghiDe: readonly GhiDeDonVi[] }): DonViTiet {
  if (p.thoiLuongDayPhut === p.chuanDayPhut) return { trangThai: "CHUAN", donVi: "1", ghiDeId: null };
  const khop = p.ghiDe.filter((g) => g.teachingDurationMinutes == null || g.teachingDurationMinutes === p.thoiLuongDayPhut);
  for (const pv of THU_TU_PHAM_VI) {
    const cung = khop.filter((g) => g.scopeType === pv);
    if (cung.length === 0) continue;
    // Trong cùng hạng: dòng khai ĐÚNG thời lượng thắng dòng "mọi thời lượng"; còn hơn một ⇒ xung đột.
    const dung = cung.filter((g) => g.teachingDurationMinutes === p.thoiLuongDayPhut);
    const chon = dung.length ? dung : cung;
    if (chon.length > 1) return { trangThai: "NEEDS_POLICY_DECISION", donVi: null, ghiDeId: null, lyDo: "GHI_DE_XUNG_DOT" };
    return { trangThai: "GHI_DE", donVi: chon[0]!.teachingUnits, ghiDeId: chon[0]!.id };
  }
  return { trangThai: "NEEDS_POLICY_DECISION", donVi: null, ghiDeId: null, lyDo: "THOI_LUONG_LECH_CHUAN" };
}
