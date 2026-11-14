// lib/hoa-hong/ky-db.ts — KỲ hoa hồng ở tầng DB: tạo (idempotent), tóm tắt, khoá hàng.
//
// Nguồn: docs/source-commission/04 §10.6, §12. Hàm quyết định: `ky-hoa-hong.ts` (thuần).
//
// ⚠️ Kỳ được tạo bằng `INSERT … ON CONFLICT DO NOTHING` rồi ĐỌC LẠI — KHÔNG `upsert` của Prisma (đọc-rồi-ghi: hai lượt đua thì P2002
// và rollback cả lượt — bài học `ensureCommissionStatement`, `trial-teacher-commission.ts:137-160`). `ON CONFLICT` không chỉ định cột vì
// bảng có HAI khoá UNIQUE ((tháng, cơ sở) và (tháng, đơn vị)) và cả hai đều phải chịu đua.
// ⚠️ Không bao giờ tạo kỳ < mốc cutover (L9): engine mới không ghi kỳ cũ.
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { HoaHongError } from "./kieu";
import { laThangHopLe, type KyTomTat, type TrangThaiKy } from "./ky-hoa-hong";
import type { Khach } from "./nap-khoan";

export type KyDb = { id: string; period: string; centerId: string; orgUnitId: string; status: TrangThaiKy };

/** Kỳ (tháng × đơn vị) có trong DB; chưa có ⇒ tạo OPEN. Không bao giờ tạo kỳ < `kyCutover`. */
export async function bamKy(
  client: Khach,
  p: { thang: string; centerId: string; orgUnitId: string; kyCutover: string },
): Promise<KyDb> {
  if (!laThangHopLe(p.thang)) throw new HoaHongError("KY_KHONG_HOP_LE", `Kỳ "${p.thang}" không hợp lệ.`);
  if (p.thang < p.kyCutover) {
    throw new HoaHongError("KY_TRUOC_MOC", `Engine mới không tạo/ghi kỳ ${p.thang} < mốc cutover ${p.kyCutover}.`);
  }
  await client.$executeRaw`
    INSERT INTO "CommissionPeriod" ("id", "period", "centerId", "orgUnitId", "status", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${p.thang}, ${p.centerId}, ${p.orgUnitId}, 'OPEN'::"CommissionPeriodStatus", now(), now())
    ON CONFLICT DO NOTHING`;
  const k = await client.commissionPeriod.findFirst({ where: { period: p.thang, orgUnitId: p.orgUnitId } });
  if (!k) throw new HoaHongError("KY_KHONG_TAO_DUOC", `Không tạo/đọc được kỳ ${p.thang} cho đơn vị ${p.orgUnitId}.`);
  if (k.centerId !== p.centerId) {
    throw new HoaHongError("KY_LECH_CO_SO", `Kỳ ${p.thang} của đơn vị ${p.orgUnitId} thuộc cơ sở ${k.centerId}, không phải ${p.centerId}.`);
  }
  return { id: k.id, period: k.period, centerId: k.centerId, orgUnitId: k.orgUnitId, status: k.status };
}

/** Tóm tắt các kỳ của MỘT đơn vị từ `tu` trở đi — đầu vào của `kyGhiSo`. */
export async function docKyTomTat(client: Khach, orgUnitId: string, tu: string): Promise<KyTomTat[]> {
  const rows = await client.commissionPeriod.findMany({
    where: { orgUnitId, period: { gte: tu } },
    select: { period: true, orgUnitId: true, status: true },
  });
  return rows.map((r) => ({ thang: r.period, orgUnitId: r.orgUnitId, trangThai: r.status }));
}

/**
 * Khoá hàng kỳ (`FOR UPDATE`) và trả trạng thái HIỆN TẠI — gọi TRONG transaction ghi. Thứ tự id cố định ⇒ không khoá chéo giữa hai lượt.
 */
export async function khoaKy(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<Map<string, { period: string; orgUnitId: string; status: TrangThaiKy }>> {
  if (ids.length === 0) return new Map();
  const duy = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<{ id: string; period: string; orgUnitId: string; status: TrangThaiKy }[]>`
    SELECT "id", "period", "orgUnitId", "status"::text AS "status" FROM "CommissionPeriod"
    WHERE "id" IN (${Prisma.join(duy)}) ORDER BY "id" FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, { period: r.period, orgUnitId: r.orgUnitId, status: r.status }]));
}
