import { redirect } from "next/navigation";

export const metadata = { title: "Phương thức thanh toán | Admin" };
export const dynamic = "force-dynamic";

/**
 * ĐÃ DỜI — nội dung nay là một TAB trong Cấu hình vận hành.
 *
 * Chủ dự án 14/09/2026: "màn phương thức thanh toán: gộp vào trong cấu hình vận hành
 * thành 1 tab riêng, và ẩn khỏi sidebar luôn."
 *
 * ⚠️ GIỮ ROUTE, KHÔNG XOÁ — ba lý do, mỗi lý do đều là một đường đang sống:
 *
 *  1. Trang Cơ sở (`/centers/<id>/edit`) có nút "Quản lý phương thức thanh toán →" trỏ
 *     `/payment-methods?centerId=…`. Xoá route là nút đó 404.
 *  2. `/payment-methods/new` và `/payment-methods/[id]/edit` VẪN Ở NGUYÊN (biểu mẫu tạo
 *     và sửa). Xoá trang cha thì "new" rơi vào route động `[id]` và được hiểu là một id
 *     phương thức — trang trả rỗng thay vì 404, đúng cái bẫy đã ghi ở ALLOWLIST của
 *     `nav-coverage.test.ts` cho `/leads/new`.
 *  3. Dấu trang của người đang dùng.
 *
 * `?centerId=` được chuyển tiếp nguyên vẹn để bộ lọc theo cơ sở không mất.
 *
 * KHÔNG gác quyền ở đây: trang đích tự gác `payments:manage` cho đúng tab. Gác hai lần ở
 * hai chỗ là hai câu trả lời cho cùng một câu hỏi, và chúng sẽ trôi khỏi nhau.
 */
export default async function PaymentMethodsPage({
  searchParams,
}: {
  searchParams: Promise<{ centerId?: string }>;
}) {
  const { centerId } = await searchParams;
  const q = centerId?.trim()
    ? `&centerId=${encodeURIComponent(centerId.trim())}`
    : "";
  redirect(`/cau-hinh-van-hanh?tab=phuong-thuc-tt${q}`);
}
