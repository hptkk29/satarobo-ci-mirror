/**
 * lib/nguon/nhom-can-chu.ts — NGUỒN NÀO THẬT SỰ CẦN «CHỦ NGUỒN» (`LeadSourceGroup.ownerEmployeeId`). THUẦN.
 *
 * ── Chủ nguồn dùng vào đâu (đo 21/10/2026) ───────────────────────────────────────────────────────────────────
 *  · METADATA QUẢN TRỊ: cột trên nguồn + lịch sử `LeadSourceOwnerPeriod`; hiện ở màn nguồn. Không đổi nguồn của lead, không đổi người giới thiệu.
 *  · ATTRIBUTION: bản chụp `signals.nguon.chuNhanVienId` ghi lúc ghi nhận — CHỈ để tra «chủ lúc đó là ai» (lịch sử thắng bản chụp: `chu-nguon-lich-su.ts`).
 *  · NGƯỜI HƯỞNG HOA HỒNG: DUY NHẤT qua vai có resolver `SOURCE_OWNER` (`lib/hoa-hong/nguoi-huong.ts`). Vai khác KHÔNG đọc chủ nguồn:
 *      EMPLOYEE_REFERRAL → `referrerEmployeeId` (ảnh chụp người giới thiệu) · PARENT_REFERRAL → Sale phụ trách PH (`referrerSaleUserId`, ảnh chụp) ·
 *      PAID_ADS / WALK_IN → theo chính sách (vai Marketing theo cơ sở, `ORG_UNIT_ROLE`) — chủ nguồn KHÔNG đổi người hưởng của chúng, TRỪ KHI chính sách có
 *      một rule dùng vai `SOURCE_OWNER` (seed v1: «Marketing 1% của PAID_ADS đi tới chủ nguồn»).
 *  · QUYỀN / PHẠM VI: không có — chủ nguồn không cấp quyền gì.
 *  · CỔNG BACKFILL: trước đây MỌI nguồn đang dùng mà chưa có chủ đều bắt buộc «chấp nhận» (`NGUON_CHUA_CO_CHU`) — sai mức: chủ chỉ là metadata với nguồn mà không chính sách nào
 *    trả tiền cho `SOURCE_OWNER`. Cổng nay chỉ bắt buộc với nguồn trong tập dưới đây.
 *
 * ── Định nghĩa «cần chủ» = CÙNG định nghĩa với cổng kích hoạt chính sách (`guardrail-kich-hoat.ts`, mã `NGUON_CHUA_CO_NGUOI_PHU_TRACH` / `NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH`) ───
 *  · rule của một version ĐANG HIỆU LỰC (`ACTIVE`), vai hưởng là `SOURCE_OWNER` (đang hoạt động);
 *  · phạm vi `SOURCE_GROUP` ⇒ chỉ nguồn đó; MỌI phạm vi khác (chung · đơn vị · vai · người · campaign…) áp cho MỌI nguồn ⇒ mọi nguồn.
 *  · `UNKNOWN` không bao giờ vào tập: nó là nhóm hệ thống, không có chủ và không có hoa hồng theo nguồn.
 * Version `DRAFT` KHÔNG tính: kích hoạt nó sẽ bị chính cổng kích hoạt chặn nếu thiếu chủ — tức fail-closed vẫn nằm ở chỗ tiền thật sự bắt đầu chạy.
 *
 * Không đọc DB, không đọc đồng hồ. Tầng đọc: `docNhomCanChuNguon` ở `di-tru-db.ts`.
 */
import type { NhomDiTru } from "./di-tru-ke-hoach";

/** Một rule đang hiệu lực mà vai hưởng là `SOURCE_OWNER`: chỉ cần phạm vi của version chứa nó. */
export type RuleCanChuNguon = { scopeType: string; scopeSourceGroupId: string | null };

export function nhomNguonCanChu(rules: readonly RuleCanChuNguon[], nhom: readonly Pick<NhomDiTru, "id" | "code">[]): ReadonlySet<string> {
  const ra = new Set<string>();
  const dungDuoc = nhom.filter((g) => g.code !== "UNKNOWN");
  for (const r of rules) {
    if (r.scopeType === "SOURCE_GROUP") {
      // SOURCE_GROUP mà thiếu id nhóm = dữ liệu hỏng: coi như áp mọi nguồn (fail-closed), không bỏ qua im lặng.
      if (r.scopeSourceGroupId === null) {
        for (const g of dungDuoc) ra.add(g.code);
        continue;
      }
      const g = dungDuoc.find((x) => x.id === r.scopeSourceGroupId);
      if (g) ra.add(g.code);
      continue;
    }
    for (const g of dungDuoc) ra.add(g.code);
  }
  return ra;
}
