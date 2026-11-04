// lib/hoa-hong/legacy-reversal.ts — LEGACY_REVERSAL: hoàn tiền của khoản mà DÒNG GỐC thuộc engine CŨ (04 §11.3, CUT-5).
//
// Khi `chuSoHuuButToan(R) = MOI` mà `chuSoHuuButToan(G) = CU`: gốc G nằm trong bảng kê cũ (DRAFT/REOPENED hoặc APPROVED có manifest chứa G), không có ô nào
// ở sổ mới ⇒ KHÔNG có dòng gốc để đảo. Hoàn tiền này vẫn phải THU HỒI hoa hồng đã trả, nên chạy NGUYÊN pipeline cũ trên riêng R:
//
//     tinhHoaHongTheoKy({ period: kỳ của R, butToan: mapButToanHoaHong([R], phanCong), ratesAt })
//
// Kết quả là ảnh gương của `computeClawback` (rate theo ngày GỐC — `mocCuaButToan.rateDate`), tức đúng số mà engine cũ sẽ ra nếu R nằm trong kỳ của nó.
// Chạy lại pipeline cũ (không viết công thức thứ hai) là cách duy nhất bảo đảm "âm đúng bằng số engine cũ sẽ ra" (COM-12) kể cả khi tỉ lệ ngày nay khác.
//
// ⚠️ KHÔNG đảo `TRIAL_TEACHER` cũ: engine cũ chưa từng thu hồi tầng này (`trial-teacher-commission.ts` không có đường âm) — giữ nguyên hành vi (04 Q10).
// ⚠️ Tầng cũ → vai mới theo `legacyTier` của master (04 §6.7): SALE→SALE · SALE_ADMIN→SALE_ADMIN · QL_TT→CENTER_MANAGER · QC→MARKETING.
//
// Tệp này CHỈ TÍNH (đọc DB bằng client truyền vào, KHÔNG scope). Ghi sổ nằm ở `quet-khoan.ts` (một đường ghi — `[NHH-W5]`).
import type { Prisma, PrismaClient } from "@prisma/client";

import { pickEffectiveRates } from "@/lib/crm/commission-config";
import { SELECT_HOA_HONG, SELECT_PHAN_CONG, mapButToanHoaHong, type HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { kyCuaButToan, tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";

import { MASTER_VAI_HUONG } from "./vai-huong";

type Khach = PrismaClient | Prisma.TransactionClient;

export type DongLegacy = {
  /** Tầng CŨ (`QC` · `SALE_ADMIN` · `SALE` · `QL_TT`). */
  tier: string;
  /** Vai MỚI tương ứng (`BeneficiaryRole.code`). */
  roleCode: string;
  /** `User.id` của người hưởng tầng đó (đã quy theo `Lead.convertedById` / `adminId` / sổ phân công tại `assigneeDate` của GỐC). */
  recipientId: string;
  /** VND, ÂM. */
  amount: number;
  leadId: string | null;
  note: string;
};

/** Tầng cũ → mã vai mới. `null` = tầng không có vai tương ứng (không được xảy ra với 4 tầng Sale; GV Trial không đi đường này). */
export function vaiCuaTangCu(tier: string): string | null {
  return MASTER_VAI_HUONG.find((v) => v.legacyTier === tier && tier !== "TRIAL_TEACHER")?.code ?? null;
}

/**
 * Các dòng thu hồi (ÂM) mà ENGINE CŨ sẽ ra cho khoản hoàn `paymentId`. Rỗng = không có gì để thu hồi (tái tục, không người hưởng…).
 * Nạp THẲNG `Payment` bằng `SELECT_HOA_HONG` của engine cũ — cùng cột, cùng mapping, nên cùng kết quả.
 */
export async function tinhLegacyReversal(client: Khach, paymentId: string): Promise<DongLegacy[]> {
  const row = await client.payment.findUnique({ where: { id: paymentId }, select: SELECT_HOA_HONG });
  if (!row) return [];
  const [rateRows, phanCong] = await Promise.all([
    client.commissionRateConfig.findMany({ select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true } }),
    // TOÀN BỘ sổ phân công, không lọc theo kỳ: bút toán hoàn soi mốc xác nhận của khoản GỐC, có thể nằm nhiều tháng trước (khuôn `chotKyHoaHong`).
    client.centerCommissionAssignee.findMany({ select: SELECT_PHAN_CONG }),
  ]);
  const butToan = mapButToanHoaHong([row as unknown as HangThanhToanHoaHong], phanCong);
  const dong = tinhHoaHongTheoKy({
    period: kyCuaButToan(row.paidDate),
    butToan,
    ratesAt: (at) => pickEffectiveRates(rateRows, at),
  });
  const ra: DongLegacy[] = [];
  for (const d of dong) {
    const roleCode = vaiCuaTangCu(d.tier);
    if (!roleCode || d.amount >= 0) continue; // chỉ phần THU HỒI; dòng dương (không có với bút toán hoàn) bị bỏ — không bao giờ ghi tiền ra ở đường này
    ra.push({ tier: d.tier, roleCode, recipientId: d.recipientId, amount: d.amount, leadId: d.leadId, note: d.note });
  }
  return ra.sort((a, b) => (a.roleCode === b.roleCode ? (a.recipientId < b.recipientId ? -1 : 1) : a.roleCode < b.roleCode ? -1 : 1));
}
