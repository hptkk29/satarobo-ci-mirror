// lib/entitlements/cai-dat.ts — ĐỔI GIÁ TRỊ CÀI ĐẶT (SystemSetting/CenterSetting) THÀNH THAM SỐ CỦA HÀM THUẦN.
//
// THUẦN (không DB, không `server-only`): bản đọc DB ở `feature.ts`. Tách ra để phép ÁNH XẠ — chỗ
// dễ lệch nhất, vì tên trong cài đặt (MANUAL / NO_DISCOUNT / LOWER_TIER) khác tên trong hàm giá —
// kiểm được mà không cần dựng DB.

import type { QuyTacBuoiLe } from "@/lib/pricing/tinh-gia-theo-moc";
import type { CauHinhPhamVi, ChinhSachVuotTran } from "./pham-vi-hoc";
import { CAU_HINH_PHAM_VI_MAC_DINH } from "./pham-vi-hoc";

export type GiaTriOddRule = "MANUAL" | "NO_DISCOUNT" | "LOWER_TIER";

const ODD_RULE: Readonly<Record<GiaTriOddRule, QuyTacBuoiLe>> = {
  MANUAL: "NHAP_TAY",
  NO_DISCOUNT: "KHONG_GIAM",
  LOWER_TIER: "MOC_THAP_HON",
};

/** `pricing.oddSessionsRule` → quy tắc của hàm giá. Giá trị lạ ⇒ `TU_CHOI` (fail-closed). */
export function quyTacBuoiLeTuCaiDat(v: string): QuyTacBuoiLe {
  return Object.prototype.hasOwnProperty.call(ODD_RULE, v) ? ODD_RULE[v as GiaTriOddRule] : "TU_CHOI";
}

/** Thứ tự CON mặc định khi mua cùng lúc (`pricing.sameTimeChildOrder`, S15). */
export type ThuTuConMacDinh = "LOWER_VALUE_FIRST" | "HIGHER_VALUE_FIRST";

/** `pricing.sameTimeChildOrder` → tham số hàm xếp hạng. Giá trị lạ ⇒ mặc định đã khai ở registry (thấp trước). */
export function thuTuConTuCaiDat(v: unknown): ThuTuConMacDinh {
  return v === "HIGHER_VALUE_FIRST" ? "HIGHER_VALUE_FIRST" : "LOWER_VALUE_FIRST";
}

export interface GiaTriCaiDatPhamVi {
  readonly lateEntryMaxLessons: number;
  readonly catchUpMaxSessions: number;
  readonly catchUpOverCapPolicy: string;
  readonly graceCountsTowardNextPurchase: boolean;
}

/**
 * Cấu hình trần học vượt có RÕ RÀNG không: chính sách là một trong hai giá trị biết được, trần và ngưỡng là số nguyên ≥ 0. `false` ⇒ `cauHinhPhamViTuCaiDat` đã
 * rơi về giá trị an toàn (chính sách lạ ⇒ DROP_ALL) — dùng cho luật "QLCS duyệt học vượt trong trần MẶC ĐỊNH khi cấu hình không rõ" (hoc-vuot-duyet.ts).
 */
export function caiDatPhamViRoRang(v: GiaTriCaiDatPhamVi): boolean {
  const soHopLe = (x: unknown): boolean => typeof x === "number" && Number.isInteger(x) && x >= 0;
  return (v.catchUpOverCapPolicy === "KEEP_LATEST" || v.catchUpOverCapPolicy === "DROP_ALL") && soHopLe(v.catchUpMaxSessions) && soHopLe(v.lateEntryMaxLessons);
}

/**
 * Giá trị cài đặt → `CauHinhPhamVi`. `soBaiMotHocPhan` và `tongBai` KHÔNG phải cài đặt (đặc tính của
 * giáo trình), nên lấy từ mặc định. Chính sách vượt trần lạ ⇒ `DROP_ALL`: mất bài thì người ta thấy
 * ngay, còn giữ nhầm bài ngoài trần thì lặng lẽ dạy quá mức đã chốt.
 */
export function cauHinhPhamViTuCaiDat(v: GiaTriCaiDatPhamVi): CauHinhPhamVi {
  const chinhSach: ChinhSachVuotTran = v.catchUpOverCapPolicy === "KEEP_LATEST" ? "KEEP_LATEST" : "DROP_ALL";
  return {
    ...CAU_HINH_PHAM_VI_MAC_DINH,
    lateEntryMaxLessons: v.lateEntryMaxLessons,
    catchUpMaxSessions: v.catchUpMaxSessions,
    catchUpOverCapPolicy: chinhSach,
    graceCountsTowardNext: v.graceCountsTowardNextPurchase,
  };
}
