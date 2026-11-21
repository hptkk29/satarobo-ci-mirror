// Loader (server) của trang chủ: giá các khoá hiển thị trên thẻ + FAQ.
// Chỉ đọc `Course.price` của ĐÚNG slug (sata1/sata3/sata4/sata5), khoá phải đang công khai và có giá
// > 0 — luật quyết định nằm ở hàm thuần `dungGiaTrangChu` (home-thuan.ts). Lỗi DB ⇒ không có giá
// (thẻ bỏ dòng giá), không bịa số và không rơi về bảng giá hằng/khoá demo trùng tiền tố.
import { db } from "@/lib/db";
import { dangAnHocPhi } from "@/lib/public/hoc-phi-an-db";
import { dungGiaTrangChu, SLUG_GIA_TRANG_CHU, type GiaTrangChu } from "./home-thuan";

export async function layGiaTrangChu(): Promise<GiaTrangChu> {
  // Website đang ẩn học phí ⇒ như "không có giá": thẻ bỏ dòng giá, FAQ không nêu số.
  if (await dangAnHocPhi()) return dungGiaTrangChu([]);
  try {
    const hang = await db.course.findMany({
      where: { slug: { in: [...SLUG_GIA_TRANG_CHU] } },
      select: { slug: true, price: true, isPublished: true },
    });
    return dungGiaTrangChu(hang);
  } catch {
    return dungGiaTrangChu([]);
  }
}
