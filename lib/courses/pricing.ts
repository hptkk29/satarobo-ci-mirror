// lib/courses/pricing.ts — R6-B4: giá khóa/gói đọc từ DB (CoursePackage) + audit đổi giá.
// Public page ưu tiên giá DB, fallback hardcode. Đổi giá ở admin ghi AuditLog (T9).
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

/** Giá lấy từ CoursePackage (DB) — null = không cấu hình → dùng fallback. */
export type DbPackagePrice = {
  priceOriginal?: number | null;
  priceEarlyBird?: number | null;
  priceMember?: number | null;
};

export type ResolvedPrice = { listPrice: number; earlyBirdPrice?: number };

/** THUẦN — giá hiển thị: DB thắng khi có, ngược lại fallback hardcode (T1). */
export function resolveCoursePrice(
  dbPkg: DbPackagePrice | null | undefined,
  fallback: { listPrice: number; earlyBirdPrice?: number },
): ResolvedPrice {
  return {
    listPrice: dbPkg?.priceOriginal ?? fallback.listPrice,
    earlyBirdPrice: dbPkg?.priceEarlyBird ?? fallback.earlyBirdPrice,
  };
}

export const PRICE_FIELDS = ["priceOriginal", "priceEarlyBird", "priceMember"] as const;
export type PriceFields = Pick<DbPackagePrice, (typeof PRICE_FIELDS)[number]>;

/** THUẦN — field giá đổi giữa old/new (để audit chỉ khi thật sự đổi giá). */
export function diffPriceFields(
  oldP: PriceFields,
  newP: PriceFields,
): { field: string; from: number | null; to: number | null }[] {
  const out: { field: string; from: number | null; to: number | null }[] = [];
  for (const f of PRICE_FIELDS) {
    const a = oldP[f] ?? null;
    const b = newP[f] ?? null;
    if (a !== b) out.push({ field: f, from: a, to: b });
  }
  return out;
}

/** Ghi AuditLog khi giá gói thay đổi (T9). Không đổi giá → không ghi. */
export async function auditPackagePriceChange(
  actor: AuditActor,
  params: { packageId: string; oldPrice: PriceFields; newPrice: PriceFields; reason?: string },
): Promise<boolean> {
  const changes = diffPriceFields(params.oldPrice, params.newPrice);
  if (changes.length === 0) return false;
  await writeAudit({
    actor,
    module: "course-package",
    entityType: "CoursePackage",
    entityId: params.packageId,
    action: "PRICE_CHANGE",
    oldValues: Object.fromEntries(changes.map((c) => [c.field, c.from])),
    newValues: Object.fromEntries(changes.map((c) => [c.field, c.to])),
    changedFields: changes.map((c) => c.field),
    reason: params.reason,
  });
  return true;
}

/** Đọc giá hiện tại của gói (trước khi update) để so sánh audit. */
export async function getPackagePrice(id: string): Promise<PriceFields | null> {
  return db.coursePackage.findUnique({
    where: { id },
    select: { priceOriginal: true, priceEarlyBird: true, priceMember: true },
  });
}
