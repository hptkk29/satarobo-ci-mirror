// lib/crm/commission-config.ts — R6-B1: tỉ lệ hoa hồng theo kỳ trong DB.
// Thay hằng số DEFAULT_RATES bằng CommissionRateConfig (version theo effectiveFrom/To).
// - getEffectiveRates(at): rate hiệu lực tại thời điểm đóng đơn (fallback DEFAULT_RATES).
// - setCommissionRate(actor): SUPER_ADMIN sửa, trần Σ ≤ 8%, đóng version cũ, audit + reason.
// - recompute lines: chỉ statement DRAFT; APPROVED bất biến (T6).
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { TRIAL_TEACHER_RATE } from "@/lib/crm/trial-teacher-commission";
import {
  COMMISSION_TIERS,
  DEFAULT_RATES,
  CommissionError,
  computeCommission,
  type CommissionTier,
  type CommissionLine,
} from "@/lib/crm/commission";

export type RateRow = {
  tier: string;
  rate: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

/** THUẦN — rate hiệu lực mỗi tier tại `at`: row phủ thời điểm, mới nhất thắng; thiếu → default. */
export function pickEffectiveRates(rows: RateRow[], at: Date): Record<CommissionTier, number> {
  const out = { ...DEFAULT_RATES };
  for (const tier of COMMISSION_TIERS) {
    const covering = rows
      .filter(
        (r) =>
          r.tier === tier &&
          r.effectiveFrom <= at &&
          (r.effectiveTo == null || at < r.effectiveTo),
      )
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    if (covering[0]) out[tier] = covering[0].rate;
  }
  return out;
}

/** Tổng rate hiệu lực tại `at` (để kiểm trần). */
export function totalRateAt(rows: RateRow[], at: Date): number {
  const rates = pickEffectiveRates(rows, at);
  return COMMISSION_TIERS.reduce((s, t) => s + rates[t], 0);
}

export async function getEffectiveRates(opts?: { at?: Date }): Promise<Record<CommissionTier, number>> {
  const at = opts?.at ?? new Date();
  const rows = await db.commissionRateConfig.findMany({
    select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true },
  });
  return pickEffectiveRates(rows, at);
}

export type SetRateResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string; field?: string } };

function fail(code: string, message: string, field?: string): SetRateResult {
  return { ok: false, error: { code, message, field } };
}

/** SUPER_ADMIN đặt rate mới cho 1 tier từ `effectiveFrom`; đóng version đang mở; audit. */
export async function setCommissionRate(
  actor: Actor,
  params: {
    tier: CommissionTier;
    rate: number;
    effectiveFrom: Date;
    reason: string;
    actorName: string;
  },
): Promise<SetRateResult> {
  if (!actor.isSuperAdmin) return fail("FORBIDDEN", "Chỉ SUPER_ADMIN được sửa tỉ lệ hoa hồng");
  if (!COMMISSION_TIERS.includes(params.tier)) return fail("VALIDATION", "Tier không hợp lệ", "tier");
  if (!(params.rate >= 0 && params.rate <= 1)) return fail("VALIDATION", "Tỉ lệ phải trong [0,1]", "rate");
  if (!params.reason?.trim()) return fail("VALIDATION", "Lý do thay đổi là bắt buộc", "reason");

  const rows = await db.commissionRateConfig.findMany({
    select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true },
  });

  // Trần: tổng rate tại effectiveFrom sau khi thay tier này, CỘNG tầng GV dạy Trial,
  // phải ≤ trần đang cấu hình.
  //
  // 27/08/2026 — hai đổi thay ở đây, cả hai đều đảo luật cũ:
  //  1. Trần đọc từ `crm.commissionMaxTotalRate` (quản trị hệ thống sửa được), không
  //     còn là hằng `MAX_TOTAL_RATE` phải sửa code mới đổi được.
  //  2. Tầng `TRIAL_TEACHER` nay **được tính vào** tổng. Trước đó nó cố ý nằm ngoài mọi
  //     ràng buộc vì trần 8% đã bão hoà bởi 4 tầng Sale — nghĩa là 1% GV chi ra mà không
  //     con số nào ràng. Nới lên 9% chính là để kéo nó vào trong.
  const maxTotalRate = await getSetting("crm.commissionMaxTotalRate");
  const othersTotal = COMMISSION_TIERS.filter((t) => t !== params.tier).reduce(
    (s, t) => s + pickEffectiveRates(rows, params.effectiveFrom)[t],
    0,
  );
  const tongGomGV = othersTotal + params.rate + TRIAL_TEACHER_RATE;
  if (tongGomGV > maxTotalRate + 1e-9) {
    return fail(
      "RATE_EXCEEDS_CAP",
      `Tổng tỉ lệ ${(tongGomGV * 100).toFixed(2)}% (đã gồm ${(TRIAL_TEACHER_RATE * 100).toFixed(2)}% GV dạy Trial) ` +
        `vượt trần ${(maxTotalRate * 100).toFixed(2)}%. Sửa trần ở Cấu hình vận hành nếu đây là chủ ý.`,
    );
  }

  await db.$transaction(async (tx) => {
    // Đóng version đang mở của tier (effectiveTo = effectiveFrom mới).
    await tx.commissionRateConfig.updateMany({
      where: { tier: params.tier, effectiveTo: null, effectiveFrom: { lte: params.effectiveFrom } },
      data: { effectiveTo: params.effectiveFrom },
    });
    await tx.commissionRateConfig.create({
      data: {
        tier: params.tier,
        rate: params.rate,
        effectiveFrom: params.effectiveFrom,
        reason: params.reason,
        createdById: actor.userId,
        createdByName: params.actorName,
      },
    });
    await writeAudit({
      actor: { id: actor.userId, name: params.actorName },
      module: "commission",
      entityType: "CommissionRateConfig",
      entityId: params.tier,
      action: "UPDATE",
      newValues: { tier: params.tier, rate: params.rate, effectiveFrom: params.effectiveFrom.toISOString() },
      reason: params.reason,
      tx,
    });
  });
  return { ok: true };
}

/** T6 — statement APPROVED bất biến. Throw nếu cố recompute. */
export function assertStatementMutable(status: string): void {
  if (status === "APPROVED") {
    throw new CommissionError("STATEMENT_LOCKED", "Bảng hoa hồng đã duyệt — không được tính lại.");
  }
}

export type CommissionSource = {
  revenue: number;
  isRenewal: boolean;
  recipients: Partial<Record<CommissionTier, string>>;
};

/**
 * Tính lại các dòng hoa hồng cho 1 statement bằng rate hiệu lực tại `at`.
 * DRAFT/REOPENED → tính lại; APPROVED → throw (bất biến).
 */
export function recomputeStatementLines(
  status: string,
  sources: CommissionSource[],
  rates: Record<CommissionTier, number>,
): CommissionLine[] {
  assertStatementMutable(status);
  return sources.flatMap((s) =>
    computeCommission({ revenue: s.revenue, isRenewal: s.isRenewal, recipients: s.recipients, rates }),
  );
}
