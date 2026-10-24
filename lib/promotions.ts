// lib/promotions.ts — đọc ưu đãi/khuyến mãi từ DB (model Promotion), fallback về
// dữ liệu tĩnh _data/promotions.ts khi bảng trống (2-phase additive).
import { db } from "@/lib/db";
import {
  promotions as STATIC_PROMOTIONS,
  type Promotions,
} from "@/components/legacy-laptrinhrobot/_data/promotions";

/**
 * Ưu đãi đang active (PRIMARY + SECONDARY), giữ đúng shape `Promotions` cũ để
 * component dùng không đổi. `courseSlug` lọc theo landing (kèm bản chung null).
 * Bảng trống → trả dữ liệu tĩnh (fallback).
 */
export async function getPromotions(courseSlug?: string): Promise<Promotions> {
  const now = new Date();
  let rows;
  try {
    rows = await db.promotion.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
        ...(courseSlug ? { OR: [{ courseSlug }, { courseSlug: null }] } : {}),
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
  } catch {
    // Bảng chưa tồn tại (migration chưa apply) → dùng dữ liệu tĩnh (2-phase additive).
    return STATIC_PROMOTIONS;
  }
  if (rows.length === 0) return STATIC_PROMOTIONS;
  return {
    primary: rows
      .filter((r) => r.kind === "PRIMARY")
      .map((r) => ({
        id: r.slug,
        title: r.title,
        highlight: r.highlight,
        description: r.description,
        details: r.details,
        cta: r.cta ?? "",
        target: r.target ?? "",
        icon: r.icon,
        featured: r.featured,
      })),
    secondary: rows
      .filter((r) => r.kind === "SECONDARY")
      .map((r) => ({
        id: r.slug,
        title: r.title,
        highlight: r.highlight,
        description: r.description,
        condition: r.condition ?? "",
        note: r.note ?? "",
        icon: r.icon,
      })),
  };
}
