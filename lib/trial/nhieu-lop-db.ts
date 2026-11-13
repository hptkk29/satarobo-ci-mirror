// Đọc/ghi phía DB cho luật "bé học thử nhiều lớp" (`lib/trial/nhieu-lop.ts`).
//
// Câu tra để CHẶN cố ý KHÔNG đi qua `scopedDb`: lượt trial của bé ở lớp khác bị lọc mất thì cổng
// đọc ra "bé chưa ở đâu cả" và mở toang đúng lúc phải đóng (cùng bài học `lib/payments/method-lookup.ts`).

import { db } from "@/lib/db";
import type { TrialKhacCuaBe } from "@/lib/trial/nhieu-lop";

export type LuotTrialKhac = TrialKhacCuaBe & { id: string; trialClassId: string };

/** Các lượt trial ACTIVE/COMPLETED của bé, trừ lớp (hoặc lượt) đang xét. */
export async function docLuotTrialKhacCuaBe(
  leadChildId: string,
  boQua: { trialClassId?: string; trialEnrollmentId?: string },
): Promise<LuotTrialKhac[]> {
  const rows = await db.trialEnrollment.findMany({
    where: {
      leadChildId,
      status: { in: ["ACTIVE", "COMPLETED"] },
      ...(boQua.trialClassId ? { trialClassId: { not: boQua.trialClassId } } : {}),
      ...(boQua.trialEnrollmentId ? { id: { not: boQua.trialEnrollmentId } } : {}),
    },
    select: { id: true, trialClassId: true, status: true, courseId: true },
  });
  return rows;
}

/**
 * Lượt ACTIVE cũ chưa biết khoá ⇒ chụp khoá hiện tại của bé vào đó, TRƯỚC khi bé nhận lượt mới
 * (lúc này khoá quan tâm của bé còn là khoá của lượt cũ). Không có khoá để chụp thì để NULL.
 */
export async function chupKhoaChoLuotCu(leadChildId: string, khoa: string | null): Promise<void> {
  if (!khoa) return;
  await db.trialEnrollment.updateMany({
    where: { leadChildId, status: "ACTIVE", courseId: null },
    data: { courseId: khoa },
  });
}

/** Ghi khoá cho đúng MỘT lượt trial. `chiKhiTrong` = chỉ ghi khi lượt đó chưa có khoá. */
export async function ghiKhoaChoLuotTrial(
  trialEnrollmentId: string,
  courseId: string,
  chiKhiTrong = false,
): Promise<void> {
  await db.trialEnrollment.updateMany({
    where: { id: trialEnrollmentId, ...(chiKhiTrong ? { courseId: null } : {}) },
    data: { courseId },
  });
}
