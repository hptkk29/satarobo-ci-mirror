// lib/reports/revenue-target-data.ts — #10 (Dashboard đa vai trò, câu 16).
// Nạp RevenueTarget theo tầm nhìn cơ sở của actor. TÁCH khỏi revenue-target.ts (thuần,
// test không cần DB) vì hàm này CHẠM DB. Ghép với buildRevenueTargetReport (thuần) ở page.
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import type { RevenueTargetRow } from "@/lib/reports/revenue-target";
import { monthKeysInRange, type TargetScopeMode } from "@/lib/reports/revenue-target-range";

/**
 * Mục tiêu doanh thu (RevenueTarget) trong phạm vi của actor.
 * RevenueTarget ∈ SCOPE_EXEMPT (config KPI, centerId null = toàn hệ thống) → scopedDb
 * KHÔNG auto-scope; phải scope TAY — ĐỒNG BỘ với scope per-model của Payment (doanh thu
 * THỰC trên dashboard cũng scope theo Payment) để actual vs target cùng phạm vi.
 * Vá 24/07: trước đây `isHoLevel → centerId null` nên actor kiểu Toại (TRAINING@HO +
 * CM@CS1) thấy mục tiêu TOÀN CÔNG TY trong khi actual chỉ CS1.
 *  - scope Payment = "ALL" (SUPER_ADMIN / role HO có payments:* toàn hệ) → mục tiêu
 *    TOÀN HỆ THỐNG (centerId = null) — như cũ.
 *  - scope Payment = [centerIds] → mục tiêu của đúng các cơ sở đó (cách ly cơ sở);
 *    cơ sở chưa đặt mục tiêu → không có row → báo cáo hiện "chưa đặt mục tiêu"
 *    (target null), KHÔNG fallback về mục tiêu toàn hệ thống (sai phạm vi so sánh).
 */
export async function getRevenueTargets(actor: Actor): Promise<RevenueTargetRow[]> {
  const scope = getModelVisibleCenterIds("Payment", actor);
  const where =
    scope === "ALL" ? { centerId: null } : { centerId: { in: scope } };
  const rows = await db.revenueTarget.findMany({
    where,
    select: { centerId: true, period: true, targetAmount: true },
  });
  return rows.map((t) => ({ centerId: t.centerId, period: t.period, targetAmount: t.targetAmount }));
}

/**
 * B-02 — mục tiêu doanh thu của MỌI KỲ chạm khoảng ngày đang xem, cho dashboard QLCS.
 *
 * Cố ý là hàm MỚI, không sửa `getRevenueTargets` ở trên: hàm cũ không nhận bộ lọc nên
 * không biết người xem đang chọn cơ sở nào và khoảng ngày nào — nó chỉ trả "mọi mục tiêu
 * trong tầm nhìn actor". Sửa nó là đổi im lặng con số của `manager-dashboard`, một màn
 * ngoài phạm vi B-02.
 *
 * ⚠️ `RevenueTarget` ∈ `SCOPE_EXEMPT` (`lib/db-scope.ts`) ⇒ `scopedDb` là PASS-THROUGH ở
 * bảng này, KHÔNG ai lọc giúp. Mọi mệnh đề phạm vi dưới đây phải TỰ ĐẶT, và `centerIds`
 * đưa vào đã qua `resolveScopeFilters` (giao với tầm nhìn actor) nên không mở IDOR.
 *
 * Dòng `centerId = NULL` (mục tiêu TOÀN HỆ THỐNG) chỉ được ĐỌC ở chế độ `SYSTEM` — xem
 * `targetScopeMode` để biết vì sao `isAllCenters` một mình là chưa đủ. Chọn ba luật gộp
 * nằm ở hàm thuần `buildRangeTarget`, không ở đây: tầng này CHỈ nạp.
 *
 * ⚠️ Nhận `fromKey`/`toKey` (ngày lịch giờ VN) chứ KHÔNG tự suy từ `ScopeFilters`: khi
 * khoảng dài hơn trần thì B-04 đã CẮT (`trimDayRange`) và doanh thu chỉ tính phần đã
 * cắt. Suy lại từ bộ lọc gốc ở đây là mục tiêu phủ nhiều tháng hơn doanh thu ⇒ tỷ lệ
 * hoàn thành tụt mà không ai giải thích được. Chỗ gọi truyền đúng khoảng ĐANG VẼ.
 */
export async function getRevenueTargetsForRange(
  actor: Actor,
  range: { fromKey: string; toKey: string },
  mode: TargetScopeMode,
): Promise<RevenueTargetRow[]> {
  const periods = monthKeysInRange(range.fromKey, range.toKey);
  if (periods.length === 0) return [];

  // Chưa có cơ sở nào trong tầm nhìn: ở chế độ CENTERS thì chắc chắn không có gì để lấy
  // (`{ in: [] }` trả rỗng), nhưng ở SYSTEM vẫn còn dòng toàn hệ thống — nên không
  // return sớm mà để mệnh đề OR bên dưới tự xử.
  const where = {
    period: { in: periods },
    OR: [
      { centerId: { in: [...mode.centerIds] } },
      ...(mode.kind === "SYSTEM" ? [{ centerId: null }] : []),
    ],
  };

  const rows = await scopedDb(actor).revenueTarget.findMany({
    where,
    select: { centerId: true, period: true, targetAmount: true },
    // Trần cứng: ≤ 13 kỳ (khoảng đã bị `trimDayRange` cắt về 366 ngày) × số cơ sở.
    take: 5_000,
  });
  return rows.map((t) => ({
    centerId: t.centerId,
    period: t.period,
    targetAmount: t.targetAmount,
  }));
}
