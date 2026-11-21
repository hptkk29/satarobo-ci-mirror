/**
 * lib/affiliate/quyen-bao-cao.ts — MỘT chỗ duy nhất đổi quyền của người xem thành `QuyenBaoCao` cho khối «Hiệu quả» (AFF-P3 H1).
 *
 * Mỗi khối dùng ĐÚNG khoá của tab sở hữu dữ liệu đó (luật 12 — màn nào mở được thì khối ấy mới được đọc):
 *   · lượt bấm   ← khoá vào tab Link        (`PAGE_GATES["/nguon-hoa-hong/link"]`)
 *   · referral   ← khoá vào tab Referral    (`PAGE_GATES["/nguon-hoa-hong/referral"]`)
 *   · hoa hồng   ← xem sổ của cơ sở (`commission:view-center`) VÀ engine hoa hồng đang bật — cùng điều kiện để thấy dòng của người khác ở tab Sổ
 * Nằm ở `lib/` chứ không inline trong page để (a) page tab chỉ chứa gate của CHÍNH nó (lưới `[AFC-W1]`) và (b) test được bằng một `scope` dựng tay.
 */
import { PAGE_GATES } from "@/lib/auth/page-gates";
import type { NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";

import type { QuyenBaoCao } from "./bao-cao";

export function quyenBaoCaoTuScope(scope: Pick<NguonHoaHongScope, "any" | "has" | "co">): QuyenBaoCao {
  return {
    luotBam: scope.any(PAGE_GATES["/nguon-hoa-hong/link"]),
    referral: scope.any(PAGE_GATES["/nguon-hoa-hong/referral"]),
    hoaHong: scope.has("commission:view-center") && scope.co.engine,
  };
}
