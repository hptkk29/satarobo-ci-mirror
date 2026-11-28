// app/(teacher)/teacher/link-gioi-thieu/page.tsx — «Link giới thiệu của tôi» trên SITE GIÁO VIÊN (BGĐ 20/11: MỌI nhân sự tự tạo link giới thiệu). Giáo viên thuần bị
// đá khỏi host admin sang giaovien ⇒ thiếu bản này là họ không vào được. CÙNG nội dung + cùng lõi với màn admin (`ManLinkGioiThieu`); `userId` từ PHIÊN.
import { redirect } from "next/navigation";

import { ManLinkGioiThieu } from "@/components/admin/link-gioi-thieu/man-link-gioi-thieu";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link giới thiệu của tôi", robots: { index: false } };

export default async function LinkGioiThieuGvPage({ searchParams }: { searchParams: Promise<{ q?: string; tt?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Gọi THẲNG (không bọc JSX): trang trả về đúng cây của màn, test dựng tĩnh được.
  return ManLinkGioiThieu({ userId: session.user.id, sp: await searchParams, trang: "/teacher/link-gioi-thieu" });
}
