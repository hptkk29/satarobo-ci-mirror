// lib/crm/funnel-query.ts — R1-08: đếm funnel L1→L2→L3 + spend (cho computeFunnelMetrics).
// Lọc theo centerIds (scope dashboard).
import { db } from "@/lib/db";
import type { FunnelCounts } from "@/lib/crm/marketing-metrics";
import { dieuKienDoanhThu, docDonCoc } from "@/lib/finance/doanh-thu-coc";

export async function getFunnelCounts(opts: {
  centerIds?: string[]; // undefined = toàn hệ thống (SUPER_ADMIN/HO)
} = {}): Promise<FunnelCounts> {
  const centerFilter = opts.centerIds ? { centerId: { in: opts.centerIds } } : {};
  // Không cửa sổ ngày: chỉ loại đơn CỌC chưa trả đủ (`lib/finance/doanh-thu-coc.ts`).
  const dkDoanhThu = dieuKienDoanhThu(await docDonCoc(db), null);

  const [l1, l2, l3, spendAgg, revenueAgg] = await Promise.all([
    db.messengerConversation.count({ where: centerFilter }), // L1 = hội thoại
    db.lead.count({ where: { deletedAt: null, qualifiedAt: { not: null }, ...centerFilter } }), // L2
    db.lead.count({ where: { deletedAt: null, convertedAt: { not: null }, ...centerFilter } }), // L3
    db.adsInsightDaily.aggregate({ _sum: { spend: true } }),
    // B-02 · quyết định B3 (24/08/2026) — doanh thu (mẫu số ROAS) = THỰC THU:
    // Σ Payment kế toán đã xác nhận, ĐÃ trừ hoàn và ĐÃ thay bản gốc bằng bản điều chỉnh.
    // Trước đây cộng `Order.totalAmount` của đơn CONFIRMED/COMPLETED — giá trị hợp đồng,
    // hoàn/điều chỉnh không đụng tới ⇒ ROAS bị thổi lên mà không ai thấy.
    // 07/11/2026 — DOANH THU (không phải thực thu): thêm khoản chưa xác nhận nhưng đã có bằng chứng tiền vào ngân hàng
    // (quyết định BGĐ 01–02/11). Xem khối «DOANH THU ≠ THỰC THU» ở `lib/finance/thuc-thu.ts`.
    db.payment.aggregate({
      _sum: { amount: true },
      where: { AND: [dkDoanhThu.where, centerFilter] },
    }),
  ]);

  return {
    l1,
    l2,
    l3,
    spend: spendAgg._sum.spend ?? 0,
    revenue: revenueAgg._sum.amount ?? 0,
  };
}
