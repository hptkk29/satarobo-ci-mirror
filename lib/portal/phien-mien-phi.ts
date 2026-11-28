import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Cổng vào các trang / route GÓI MIỄN PHÍ của cổng phụ huynh (Tủ sách, Sức khỏe — 08/11/2026). Thứ tự cố định, y khuôn `phien-disc.ts`:
 *   1. cờ của trang TẮT ⇒ 404 (không phân biệt với "không có trang") — kiểm TRƯỚC khi chạm phiên/DB;
 *   2. chưa đăng nhập hoặc không phải PARENT ⇒ về /login (layout portal đã gác, đây là lớp thứ hai — luật 5);
 *   3. `userId` lấy từ PHIÊN, KHÔNG BAO GIỜ từ URL / form / query.
 * Không cần `assertCan`: dùng vai quan hệ PARENT đã có; trang không đọc dữ liệu của học viên nào.
 */
export type PhienMienPhi = { ok: true; userId: string } | { ok: false; loai: "CO_TAT" | "CHUA_DANG_NHAP" };

/** `coBat` = giá trị cờ của CHÍNH trang gọi (vd `isTuSachEnabled()`), đã đọc ở nơi gọi. */
export async function docPhienMienPhi(coBat: boolean): Promise<PhienMienPhi> {
  if (!coBat) return { ok: false, loai: "CO_TAT" };
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "PARENT") return { ok: false, loai: "CHUA_DANG_NHAP" };
  return { ok: true, userId: session.user.id };
}

/** Dùng trong `page.tsx`: cờ tắt ⇒ `notFound()`, chưa đăng nhập ⇒ `/login`. */
export async function yeuCauPhienMienPhi(coBat: boolean): Promise<{ userId: string }> {
  const p = await docPhienMienPhi(coBat);
  if (!p.ok) {
    if (p.loai === "CO_TAT") notFound();
    redirect("/login");
  }
  return { userId: p.userId };
}
