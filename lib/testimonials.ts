// lib/testimonials.ts — đọc cảm nhận PH/HV từ DB (model Testimonial). 2-phase
// additive: bảng trống HOẶC lỗi (migration chưa apply) → trả [] để component tự
// dùng dữ liệu fallback inline (KHÔNG trả dữ liệu cũ stale).
import { db } from "@/lib/db";

export interface TestimonialView {
  name: string;
  role: string;
  content: string;
  avatar: string;
  avatarColor: string;
  videoId: string | null;
  location: string;
  rating: number;
}

/**
 * Cảm nhận đã publish, ưu tiên theo `displayOrder`. `courseSlug` lọc theo landing
 * (kèm bản chung `courseSlug = null`). Bảng trống / lỗi → trả `[]` (fallback ở UI).
 */
export async function getTestimonials(courseSlug?: string): Promise<TestimonialView[]> {
  try {
    const rows = await db.testimonial.findMany({
      where: {
        isPublished: true,
        ...(courseSlug ? { OR: [{ courseSlug }, { courseSlug: null }] } : {}),
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({
      name: r.name,
      role: r.role,
      content: r.content,
      avatar: r.avatar,
      avatarColor: r.avatarColor,
      videoId: r.videoId,
      location: r.location,
      rating: r.rating,
    }));
  } catch {
    // Bảng chưa tồn tại (migration chưa apply) → để UI dùng fallback inline.
    return [];
  }
}
