import type { News } from "@prisma/client";
import { calcReadingTime } from "@/lib/blog-utils";
import { dinhDangNgay, type TinTucItem } from "@/components/blog/tin-tuc-thuan";

// Cầu nối DB → thẻ bài viết (chạy ở SERVER). Một chỗ duy nhất quyết định "bài ở danh sách mang
// những trường nào": `content` chỉ được SELECT để tính số phút đọc, KHÔNG đi tiếp xuống client.

export const SELECT_BAI_DANH_SACH = {
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  coverImage: true,
  category: true,
  publishedAt: true,
  isFeatured: true,
} as const;

export type HangBaiDanhSach = Pick<
  News,
  "slug" | "title" | "excerpt" | "content" | "coverImage" | "category" | "publishedAt" | "isFeatured"
>;

export function sangTinTucItem(r: HangBaiDanhSach): TinTucItem {
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    coverImage: r.coverImage,
    category: r.category,
    ngay: dinhDangNgay(r.publishedAt),
    phutDoc: calcReadingTime(r.content),
    noiBat: r.isFeatured,
  };
}
