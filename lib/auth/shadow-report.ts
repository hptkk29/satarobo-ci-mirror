// lib/auth/shadow-report.ts — R6-F2: persist + report lệch can() v1↔v2 (shadow).
// Bật RBAC_V2_ENABLED chỉ khi report = 0 trong N ngày. Rollback = đổi env (tức thì).
import { db } from "@/lib/db";

/** Ghi 1 bản ghi lệch (CHỈ gọi khi v1 !== v2). Fire-and-forget từ runtime. */
export async function persistShadowMismatch(params: {
  action: string;
  userId: string;
  v1: boolean;
  v2: boolean;
  targetKey?: string | null;
}): Promise<void> {
  await db.rbacShadowDiff.create({
    data: {
      action: params.action,
      userId: params.userId,
      v1: params.v1,
      v2: params.v2,
      targetKey: params.targetKey ?? null,
    },
  });
}

/** Ghi lệch nếu có (v1≠v2). Trả true nếu đã ghi. Nuốt lỗi DB (không chặn request). */
export async function recordPermissionShadow(params: {
  action: string;
  userId: string;
  v1: boolean;
  v2: boolean;
  targetKey?: string | null;
}): Promise<boolean> {
  if (params.v1 === params.v2) return false;
  try {
    await persistShadowMismatch(params);
    return true;
  } catch {
    return false;
  }
}

export type ShadowDiffStats = {
  total: number;
  byAction: Record<string, number>;
  windowDays: number;
};

/** Thống kê lệch trong cửa sổ `sinceDays` gần nhất (để dựng report). */
export async function getShadowDiffStats(opts?: {
  sinceDays?: number;
  now?: Date;
}): Promise<ShadowDiffStats> {
  const windowDays = opts?.sinceDays ?? 7;
  const now = opts?.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.rbacShadowDiff.groupBy({
    by: ["action"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const byAction: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byAction[r.action] = r._count._all;
    total += r._count._all;
  }
  return { total, byAction, windowDays };
}

/**
 * An toàn bật RBAC v2: KHÔNG còn lệch trong `minCleanDays` ngày gần nhất.
 * (Cổng quyết định flip flag — Doc 15 §2.4 / BA R6-F2-T1.)
 */
export async function isSafeToEnableRbacV2(opts?: {
  minCleanDays?: number;
  now?: Date;
}): Promise<{ safe: boolean; stats: ShadowDiffStats }> {
  const stats = await getShadowDiffStats({ sinceDays: opts?.minCleanDays ?? 7, now: opts?.now });
  return { safe: stats.total === 0, stats };
}
