import "server-only";
// lib/ai-lead/dich-vu/catalog.ts — GET /catalog: danh mục cơ sở ĐÃ XUẤT BẢN, lọc theo Page được cấp cho agent. Thứ DUY NHẤT Agent đọc được (nguyên tắc 1).
//
// ETag: `<etag snapshot>.<băm 8 ký tự của tập Page agent được cấp>`. Nếu chỉ dùng etag của snapshot thì đổi allowlist (không xuất bản lại) trả 304 mãi
// trong khi nội dung đã khác. Hợp đồng chỉ đòi `etag` ≤ 128 ký tự và `If-None-Match` mang đúng giá trị `etag` lần trước.
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { BIEN_CATALOG_MAX_AGE_GIAY } from "../hop-dong";
import { phanHoi304, phanHoiCatalog } from "../phan-hoi";
import { kiemToanVenSnapshot } from "./cau-hinh-thuan";
import type { KetQuaXuLy, NguCanhYeuCau } from "../xac-thuc";

const payloadSchema = z.object({
  pages: z.array(
    z.object({
      pageId: z.string(),
      campuses: z.array(z.object({ campusCode: z.string(), name: z.string(), address: z.string(), acceptingLeads: z.boolean() })),
    }),
  ),
});

export type CatalogCuaPage = z.infer<typeof payloadSchema>["pages"];

/** Đọc `payload` của snapshot; hỏng ⇒ `null` (coi như chưa có catalog dùng được — 503, không phát dữ liệu rác). */
export function docPayloadCatalog(payload: unknown): CatalogCuaPage | null {
  const r = payloadSchema.safeParse(payload);
  return r.success ? r.data.pages : null;
}

export async function layCatalogMoiNhat(): Promise<{ version: number; publishedAt: Date; etag: string; pages: CatalogCuaPage } | null> {
  const snap = await db.aiLeadCatalogSnapshot.findFirst({ orderBy: { version: "desc" }, select: { version: true, publishedAt: true, etag: true, payload: true } });
  if (!snap) return null;
  const pages = docPayloadCatalog(snap.payload);
  // Toàn vẹn: snapshot hỏng/bị sửa tay ⇒ coi như chưa có catalog dùng được (503), KHÔNG phát nội dung nghi ngờ. Log CHỈ mã.
  const tv = kiemToanVenSnapshot({ version: snap.version, etag: snap.etag, payload: snap.payload });
  if (!tv.ok) {
    console.error(`[ai-lead:catalog] snapshot v${snap.version} khong toan ven: ${tv.ly}`);
    return null;
  }
  return pages ? { version: snap.version, publishedAt: snap.publishedAt, etag: snap.etag, pages } : null;
}

export function etagChoAgent(etagSnapshot: string, pageIds: readonly string[]): string {
  const dau = createHash("sha256").update([...pageIds].sort().join(","), "utf8").digest("hex").slice(0, 8);
  return `${etagSnapshot}.${dau}`;
}

export function kepMaxAge(giay: number): number {
  return Math.min(BIEN_CATALOG_MAX_AGE_GIAY.max, Math.max(BIEN_CATALOG_MAX_AGE_GIAY.min, Math.floor(giay)));
}

export async function xuLyCatalog(ctx: NguCanhYeuCau<"catalog">): Promise<KetQuaXuLy> {
  const snap = await layCatalogMoiNhat();
  if (!snap) return { loai: "loi", ma: "TEMP_UNAVAILABLE", retryAfterS: 30 };
  // CHỈ Page được cấp cho agent này. Page được cấp mà snapshot chưa có ⇒ vẫn liệt kê với danh sách cơ sở rỗng (Agent biết mình có Page nhưng chưa có cơ sở).
  const duocCap = ctx.agent.pages.map((p) => p.pageId);
  const pages = duocCap.map((pageId) => ({ pageId, campuses: snap.pages.find((p) => p.pageId === pageId)?.campuses ?? [] }));
  const etag = etagChoAgent(snap.etag, duocCap);
  const maxAgeSeconds = kepMaxAge(ctx.cai.catalogMaxAgeSeconds);
  if (ctx.ifNoneMatch !== null && ctx.ifNoneMatch === etag) return { loai: "res", res: phanHoi304(ctx.nowMs, { etag, maxAgeSeconds }) };
  return {
    loai: "res",
    res: phanHoiCatalog(
      { catalogVersion: snap.version, publishedAt: snap.publishedAt.toISOString(), maxAgeSeconds, etag, pages },
      ctx,
      { etag, maxAgeSeconds },
    ),
  };
}
