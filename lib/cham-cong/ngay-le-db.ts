// lib/cham-cong/ngay-le-db.ts — ngày lễ áp cho MỘT cơ sở trong MỘT ngày. Một chỗ cho tính công
// (`recompute.ts`) và cổng duyệt đơn (đợt 4+: OT bị chặn ở ngày lễ — đó là "làm ngày nghỉ / lễ").
import type { Prisma, PrismaClient } from "@prisma/client";
import type { EngineInput } from "./engine";

type Client = Pick<PrismaClient, "holiday"> | Prisma.TransactionClient;

/** Lễ: dòng toàn hệ thống (centerId null) hoặc của đúng cơ sở, phủ ngày này. null = không phải lễ. */
export async function ngayLeCuaNgay(client: Client, centerId: string, workDate: Date): Promise<EngineInput["holiday"]> {
  const holidays = await client.holiday.findMany({
    where: {
      date: { lte: workDate },
      OR: [{ endDate: null, date: workDate }, { endDate: { gte: workDate } }],
      AND: [{ OR: [{ centerId: null }, { centerId }] }],
    },
    select: { type: true, attendanceEffect: true, coefficient: true },
  });
  const hol = holidays.find((h) => h.type === "HOLIDAY") ?? holidays[0] ?? null;
  return hol
    ? {
        coefficient: hol.coefficient,
        effect: hol.attendanceEffect ?? (hol.type === "HOLIDAY" ? "PAID_LEAVE" : "INFO_ONLY"),
      }
    : null;
}

/** Ngày lễ CÓ hiệu lực công (không phải lễ chỉ để thông tin). */
export const laLeCoHieuLuc = (h: EngineInput["holiday"]): boolean => h != null && h.effect !== "INFO_ONLY";
