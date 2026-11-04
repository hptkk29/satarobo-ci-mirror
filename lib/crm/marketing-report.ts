// lib/crm/marketing-report.ts — R1-12 C12.2: QL TT nộp báo cáo tuần/tháng (snapshot).
import type { MarketingReport, ReportPeriodType } from "@prisma/client";
import { db } from "@/lib/db";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" của 1 ngày (THUẦN). */
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** "YYYY-MM" của tháng TRƯỚC `now` (THUẦN). */
export function previousMonthKey(now: Date): string {
  return monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** Đã quá hạn chốt tháng (mặc định ngày 05) chưa — THUẦN (C9.5/C12.3). */
export function isMonthlyDeadlinePassed(now: Date, deadlineDay = 5): boolean {
  return now.getUTCDate() >= deadlineDay;
}

/** Nộp/đè báo cáo tuần/tháng (snapshot). Idempotent theo (type,key,người nộp). */
export async function submitReport(input: {
  submittedById: string;
  periodType: ReportPeriodType;
  periodKey: string;
  snapshot: Record<string, unknown>;
}): Promise<MarketingReport> {
  return db.marketingReport.upsert({
    where: {
      periodType_periodKey_submittedById: {
        periodType: input.periodType,
        periodKey: input.periodKey,
        submittedById: input.submittedById,
      },
    },
    update: { snapshot: input.snapshot as object, submittedAt: new Date() },
    create: {
      periodType: input.periodType,
      periodKey: input.periodKey,
      submittedById: input.submittedById,
      snapshot: input.snapshot as object,
    },
  });
}
