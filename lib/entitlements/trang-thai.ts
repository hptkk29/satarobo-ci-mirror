// lib/entitlements/trang-thai.ts — MÁY TRẠNG THÁI CỦA QUYỀN HỌC (BA Phần 4(a) §2.4). THUẦN.
//
// Mọi chuyển trạng thái ở tầng ghi phải hỏi `chuyenTrangThai` TRƯỚC phép ghi đầu tiên, và từ chối
// bằng `throw` (luật rollback trong CLAUDE.md: `return` không rollback).

/**
 * Phải KHỚP KHÍT enum `StudyEntitlementStatus` của schema — lưới `[ENT-ENUM]` so hai bên.
 * AWAITING_PLACEMENT = tiền đã về đủ, chưa xếp lớp · FROZEN = bảo lưu · EXHAUSTED = hết số buổi (mở ân
 * hạn nếu có) · SEAT_HOLD = hết ân hạn, giữ chỗ.
 */
export const TRANG_THAI_QUYEN_HOC = [
  "AWAITING_PLACEMENT",
  "ACTIVE",
  "FROZEN",
  "EXHAUSTED",
  "SEAT_HOLD",
  "COMPLETED",
  "EXPIRED",
  "STOPPED",
  "VOIDED",
] as const;
export type TrangThaiQuyenHoc = (typeof TRANG_THAI_QUYEN_HOC)[number];

export type SuKienQuyenHoc =
  | "XEP_LOP"
  | "BAO_LUU"
  | "PHUC_HOC"
  | "HET_BUOI"
  | "HET_AN_HAN"
  | "MUA_TIEP"
  | "HET_GIU_CHO"
  | "DUNG_HOC"
  | "HUY_HOAN"
  // ĐỀ XUẤT (chưa có trong BA): sổ cái giảm sau khi đã EXHAUSTED (điểm danh sửa từ có mặt → vắng) làm số
  // buổi còn lại > 0 trở lại. Không có sự kiện này thì quyền học kẹt ở EXHAUSTED dù còn buổi. Chỉ từ
  // EXHAUSTED, KHÔNG từ SEAT_HOLD (hết ân hạn là đã đóng cửa).
  | "MO_LAI";

type Bang = Readonly<Record<TrangThaiQuyenHoc, Readonly<Partial<Record<SuKienQuyenHoc, TrangThaiQuyenHoc>>>>>;

const BANG: Bang = {
  AWAITING_PLACEMENT: { XEP_LOP: "ACTIVE", BAO_LUU: "FROZEN", HUY_HOAN: "VOIDED" },
  ACTIVE: { HET_BUOI: "EXHAUSTED", BAO_LUU: "FROZEN", DUNG_HOC: "STOPPED" },
  // `PHUC_HOC` KHÔNG ở đây: nơi quay về phụ thuộc `statusBeforeFreeze` — xem `chuyenTrangThai`.
  FROZEN: { DUNG_HOC: "STOPPED" },
  EXHAUSTED: { MUA_TIEP: "COMPLETED", HET_AN_HAN: "SEAT_HOLD", DUNG_HOC: "STOPPED", MO_LAI: "ACTIVE" },
  SEAT_HOLD: { MUA_TIEP: "COMPLETED", HET_GIU_CHO: "EXPIRED" },
  COMPLETED: {},
  EXPIRED: {},
  STOPPED: {},
  VOIDED: {},
};

export class LoiChuyenTrangThai extends Error {
  constructor(
    public readonly tu: TrangThaiQuyenHoc,
    public readonly suKien: SuKienQuyenHoc,
  ) {
    super(`Quyền học đang ở ${tu} không nhận sự kiện ${suKien}.`);
    this.name = "LoiChuyenTrangThai";
  }
}

/** Trạng thái cuối — không chuyển đi đâu nữa. */
export function laTrangThaiCuoi(t: TrangThaiQuyenHoc): boolean {
  return Object.keys(BANG[t]).length === 0;
}

/**
 * Trạng thái kế tiếp, hoặc ném `LoiChuyenTrangThai`.
 * `PHUC_HOC` chỉ hợp lệ từ FROZEN và quay về ĐÚNG `trangThaiTruocBaoLuu` (ACTIVE hoặc AWAITING_PLACEMENT).
 */
export function chuyenTrangThai(
  tu: TrangThaiQuyenHoc,
  suKien: SuKienQuyenHoc,
  trangThaiTruocBaoLuu?: TrangThaiQuyenHoc | null,
): TrangThaiQuyenHoc {
  if (suKien === "PHUC_HOC") {
    if (tu !== "FROZEN") throw new LoiChuyenTrangThai(tu, suKien);
    if (trangThaiTruocBaoLuu !== "ACTIVE" && trangThaiTruocBaoLuu !== "AWAITING_PLACEMENT") {
      throw new LoiChuyenTrangThai(tu, suKien);
    }
    return trangThaiTruocBaoLuu;
  }
  const den = BANG[tu][suKien];
  if (!den) throw new LoiChuyenTrangThai(tu, suKien);
  return den;
}

/** Không bảo lưu khi đã hết buổi / giữ chỗ (mặc định MM-20 — chờ BLĐ). */
export function coTheBaoLuu(t: TrangThaiQuyenHoc): boolean {
  return BANG[t].BAO_LUU !== undefined;
}
