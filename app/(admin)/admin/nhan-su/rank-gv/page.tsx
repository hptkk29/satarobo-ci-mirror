// app/(admin)/admin/nhan-su/rank-gv/page.tsx — ĐƯỜNG CŨ. Chủ dự án chốt 25/10/2026: màn Rank là màn CON của mục Giáo viên (`/teachers/rank`),
// không còn mục riêng ở sidebar. Giữ trang này chỉ để link đã gửi đi không gãy; `?tab=don-gia|trial` (link trước 24/10) về danh mục đơn giá.
import { redirect } from "next/navigation";

export default async function RankGvCu({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  redirect(sp.tab === "don-gia" || sp.tab === "trial" ? "/cham-cong/don-gia-parttime" : "/teachers/rank");
}
