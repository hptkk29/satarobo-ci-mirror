import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isDiscEnabled } from "@/lib/flags";

/**
 * Cổng vào MỌI trang / route của `/portal/disc`. Thứ tự cố định:
 *   1. cờ `DISC_ENABLED` tắt ⇒ 404 (không phân biệt với "không có trang") — kiểm TRƯỚC khi chạm phiên/DB;
 *   2. chưa đăng nhập hoặc không phải PARENT ⇒ về /login (layout portal đã gác, đây là lớp thứ hai — luật 5);
 *   3. `userId` lấy từ PHIÊN, KHÔNG BAO GIỜ từ URL / form / query.
 * Không cần `assertCan`: cổng này dùng vai quan hệ PARENT đã có (không đẻ permission mới); quyền đọc là
 * QUYỀN SỞ HỮU (`claimedUserId = userId`) và nằm trong `lib/disc/portal-doc.ts`.
 */
export type PhienDisc = { ok: true; userId: string } | { ok: false; loai: "CO_TAT" | "CHUA_DANG_NHAP" };

export async function docPhienDisc(): Promise<PhienDisc> {
  if (!isDiscEnabled()) return { ok: false, loai: "CO_TAT" };
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "PARENT") return { ok: false, loai: "CHUA_DANG_NHAP" };
  return { ok: true, userId: session.user.id };
}

/** Dùng trong `page.tsx`: cờ tắt ⇒ `notFound()`, chưa đăng nhập ⇒ `/login`. */
export async function yeuCauPhienDisc(): Promise<{ userId: string }> {
  const p = await docPhienDisc();
  if (!p.ok) {
    if (p.loai === "CO_TAT") notFound();
    redirect("/login");
  }
  return { userId: p.userId };
}
